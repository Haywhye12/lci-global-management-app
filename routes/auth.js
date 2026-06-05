const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { Op } = require('sequelize');
const { User, Installation, AuditLog } = require('../models');

// Render Login Page
router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { layout: false, title: 'Login' });
});

// Handle Login POST
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ 
            where: { email },
            include: [Installation]
        });

        if (!user) {
            return res.render('login', { layout: false, error: 'Invalid email or password' });
        }

        // Check Lockout
        if (user.lockoutUntil && user.lockoutUntil > new Date()) {
            const timeLeft = Math.ceil((user.lockoutUntil - new Date()) / 1000 / 60);
            return res.render('login', { layout: false, error: `Account locked. Try again in ${timeLeft} minute(s).` });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            // Increment failed attempts
            const attempts = user.failedLoginAttempts + 1;
            const updateData = { failedLoginAttempts: attempts };
            if (attempts >= 5) {
                updateData.lockoutUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
            }
            await user.update(updateData);
            
            // Log failed login audit
            await AuditLog.create({
                action: 'LOGIN_FAILED',
                details: `Failed login attempt for email: ${email}`,
                installationId: user.installationId
            });

            return res.render('login', { 
                layout: false, 
                error: attempts >= 5 
                    ? 'Too many failed attempts. Account locked for 15 minutes.' 
                    : `Invalid email or password. Attempt ${attempts} of 5.` 
            });
        }

        // Reset failed attempts on success
        await user.update({ failedLoginAttempts: 0, lockoutUntil: null });

        // Check 2FA
        if (user.twoFactorEnabled) {
            req.session.pendingMfaUserId = user.id;
            return res.redirect('/auth/2fa/verify');
        }

        // Set Session
        req.session.user = {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            profilePicture: user.profilePicture,
            installationId: user.installationId,
            installationName: user.Installation ? user.Installation.name : 'System',
            installationSubdomain: user.Installation ? user.Installation.subdomain : null
        };

        // Log audit
        await AuditLog.create({
            action: 'LOGIN_SUCCESS',
            details: `User ${user.fullName} logged in successfully.`,
            userId: user.id,
            installationId: user.installationId
        });

        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.render('login', { layout: false, error: 'Something went wrong. Please try again.' });
    }
});

// GET 2FA verification screen
router.get('/2fa/verify', (req, res) => {
    if (!req.session.pendingMfaUserId) return res.redirect('/auth/login');
    res.render('2fa-verify', { layout: false, title: 'Verify Two-Factor Authentication' });
});

// POST 2FA verification
router.post('/2fa/verify', async (req, res) => {
    if (!req.session.pendingMfaUserId) return res.redirect('/auth/login');
    const { token } = req.body;

    try {
        const user = await User.findByPk(req.session.pendingMfaUserId, { include: [Installation] });
        if (!user) return res.redirect('/auth/login');

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token
        });

        if (!verified) {
            return res.render('2fa-verify', { layout: false, error: 'Invalid verification token. Please try again.' });
        }

        // Logged in successfully
        delete req.session.pendingMfaUserId;
        req.session.user = {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            profilePicture: user.profilePicture,
            installationId: user.installationId,
            installationName: user.Installation ? user.Installation.name : 'System',
            installationSubdomain: user.Installation ? user.Installation.subdomain : null
        };

        await AuditLog.create({
            action: '2FA_SUCCESS',
            details: `User ${user.fullName} completed 2FA challenge.`,
            userId: user.id,
            installationId: user.installationId
        });

        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.redirect('/auth/login');
    }
});

// Forgot Password Flow
router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { layout: false, title: 'Forgot Password' });
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.render('forgot-password', { layout: false, error: 'No account with that email address exists.' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        await user.update({
            passwordResetToken: token,
            passwordResetExpires: new Date(Date.now() + 3600000) // 1 hour
        });

        // Simulate sending email by providing link directly
        const resetLink = `${req.protocol}://${req.headers.host}/auth/reset-password/${token}`;
        res.render('forgot-password', { 
            layout: false, 
            success: 'A password reset link has been generated for you (simulated):',
            resetLink 
        });
    } catch (err) {
        console.error(err);
        res.render('forgot-password', { layout: false, error: 'Error generating reset token.' });
    }
});

router.get('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            where: {
                passwordResetToken: req.params.token,
                passwordResetExpires: { [Op.gt]: new Date() }
            }
        });

        if (!user) {
            return res.render('forgot-password', { layout: false, error: 'Password reset token is invalid or has expired.' });
        }

        res.render('reset-password', { layout: false, token: req.params.token, title: 'Reset Password' });
    } catch (err) {
        console.error(err);
        res.redirect('/auth/login');
    }
});

router.post('/reset-password/:token', async (req, res) => {
    const { password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.render('reset-password', { layout: false, token: req.params.token, error: 'Passwords do not match.' });
    }

    try {
        const user = await User.findOne({
            where: {
                passwordResetToken: req.params.token,
                passwordResetExpires: { [Op.gt]: new Date() }
            }
        });

        if (!user) {
            return res.render('forgot-password', { layout: false, error: 'Password reset token is invalid or has expired.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await user.update({
            password: hashedPassword,
            passwordResetToken: null,
            passwordResetExpires: null,
            failedLoginAttempts: 0,
            lockoutUntil: null
        });

        res.render('login', { layout: false, success: 'Your password has been reset successfully. Please login.' });
    } catch (err) {
        console.error(err);
        res.render('forgot-password', { layout: false, error: 'Error resetting password.' });
    }
});

// Setup 2FA GET (Called when user clicks enable in profile)
router.get('/2fa/setup', async (req, res) => {
    if (!req.session.user) return res.redirect('/auth/login');

    try {
        const user = await User.findByPk(req.session.user.id);
        
        // Generate new Speakeasy Secret
        const secret = speakeasy.generateSecret({
            name: `LCI Portal:${user.email}`
        });

        // Generate QR code Data URL
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

        // Store secret temporarily in user row
        await user.update({ twoFactorSecret: secret.base32 });

        res.json({ success: true, qrCodeUrl, secret: secret.base32 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to generate 2FA secret' });
    }
});

// Enable 2FA POST
router.post('/2fa/enable', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });
    const { token } = req.body;

    try {
        const user = await User.findByPk(req.session.user.id);
        
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token
        });

        if (!verified) {
            return res.status(400).json({ success: false, message: 'Invalid token. Verification failed.' });
        }

        await user.update({ twoFactorEnabled: true });
        
        // Update user session
        req.session.user.twoFactorEnabled = true;

        res.json({ success: true, message: '2FA enabled successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error enabling 2FA' });
    }
});

// Disable 2FA POST
router.post('/2fa/disable', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false });

    try {
        const user = await User.findByPk(req.session.user.id);
        await user.update({ twoFactorEnabled: false, twoFactorSecret: null });
        
        req.session.user.twoFactorEnabled = false;
        res.json({ success: true, message: '2FA disabled successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error disabling 2FA' });
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/auth/login');
});

module.exports = router;
