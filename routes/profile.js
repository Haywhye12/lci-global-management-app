const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { User, Installation, AuditLog } = require('../models');
const { isAuthenticated } = require('../middleware/auth');
const { uploadImage } = require('../config/cloudinary');

// Ensure temporary uploads directory exists for initial Multer write
const tempUploadDir = path.join(__dirname, '../public/uploads/temp');
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Multer temporary disk storage config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempUploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB Limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) return cb(null, true);
        cb(new Error("Error: File upload only supports images!"));
    }
});

// Helper middleware wrapper to handle multer error parsing
const handleProfileUpload = (req, res, next) => {
    upload.single('profilePicture')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.redirect('/profile?error=File too large! Maximum limit is 5MB.');
            }
            return res.redirect(`/profile?error=${err.message}`);
        }
        next();
    });
};

const handleBranchUpload = (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.redirect('/profile?error=File too large! Maximum limit is 5MB.');
            }
            return res.redirect(`/profile?error=${err.message}`);
        }
        next();
    });
};

// View Profile & Branch Branding Settings
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findByPk(req.session.user.id);
        const installation = await Installation.findByPk(req.activeInstallationId);

        const isBranchAdmin = ['superadmin', 'pastor', 'admin'].includes(req.session.user.role);

        res.render('profile', { 
            title: 'My Profile',
            user: user.get({ plain: true }),
            installation: installation ? installation.get({ plain: true }) : null,
            isBranchAdmin,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.redirect('/?error=Failed to load profile');
    }
});

// Handle Profile Update (Name/Email)
router.post('/update', isAuthenticated, async (req, res) => {
    const { fullName, email } = req.body;
    try {
        await User.update({ fullName, email }, { where: { id: req.session.user.id } });
        
        // Update Session
        req.session.user.fullName = fullName;
        req.session.user.email = email;
        
        res.redirect('/profile?success=Account updated successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/profile?error=Failed to update account');
    }
});

// Handle Profile Picture Upload to Cloudinary / Local Fallback
router.post('/upload', isAuthenticated, handleProfileUpload, async (req, res) => {
    if (!req.file) {
        return res.redirect('/profile?error=No file selected');
    }

    try {
        // Upload image using utility (handles Cloudinary and falls back to local uploads gracefully)
        const uploadedUrl = await uploadImage(req.file.path, 'lci_profiles');

        await User.update({ profilePicture: uploadedUrl }, { where: { id: req.session.user.id } });
        
        // Update Session
        req.session.user.profilePicture = uploadedUrl;

        await AuditLog.create({
            action: 'PROFILE_PICTURE_UPLOADED',
            details: `Uploaded new profile picture: ${uploadedUrl}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });
        
        res.redirect('/profile?success=Profile picture updated successfully');
    } catch (err) {
        console.error('Profile upload route error:', err);
        res.redirect('/profile?error=Failed to upload profile picture');
    }
});

// Handle Branch / Installation Branding Logo & Details Update
router.post('/branch/update', isAuthenticated, handleBranchUpload, async (req, res) => {
    const { name, timezone, currency, contactEmail, contactPhone, country, region } = req.body;

    try {
        const updateData = {
            name,
            timezone,
            currency,
            contactEmail,
            contactPhone,
            country,
            region
        };

        // If a logo is selected, upload to Cloudinary/Local
        if (req.file) {
            const uploadedUrl = await uploadImage(req.file.path, 'lci_logos');
            updateData.logoUrl = uploadedUrl;
        }

        await Installation.update(updateData, { where: { id: req.activeInstallationId } });

        await AuditLog.create({
            action: 'BRANCH_BRANDING_UPDATED',
            details: `Updated branch settings for ${name}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/profile?success=Branch branding and settings updated successfully');
    } catch (err) {
        console.error('Branch update route error:', err);
        res.redirect('/profile?error=Failed to update branch settings');
    }
});

module.exports = router;
