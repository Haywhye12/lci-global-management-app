const express = require('express');
const router = express.Router();
const { FirstTimer, FollowUp, User, Member, AuditLog } = require('../models');
const { isAuthenticated, authorize } = require('../middleware/auth');
const { Op } = require('sequelize');

// List visitors, new converts, and follow-up history
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const visitors = await FirstTimer.findAll({
            where: { installationId: req.activeInstallationId },
            include: [{ model: FollowUp, include: [{ model: User, attributes: ['fullName'] }] }],
            order: [['visitDate', 'DESC']]
        });

        // Fetch general members to allow follow-ups on regular members
        const members = await Member.findAll({
            where: { installationId: req.activeInstallationId },
            order: [['fullName', 'ASC']]
        });

        // Fetch all follow-up reminders that are pending for today or overdue
        const reminders = await FollowUp.findAll({
            where: {
                reminderDate: {
                    [Op.lte]: new Date()
                }
            },
            include: [
                { model: FirstTimer },
                { model: Member },
                { model: User, attributes: ['fullName'] }
            ],
            order: [['reminderDate', 'ASC']]
        });

        res.render('care', {
            title: 'Member Care & Follow-Up',
            visitors: visitors.map(v => v.get({ plain: true })),
            members: members.map(m => m.get({ plain: true })),
            reminders: reminders.map(r => r.get({ plain: true })),
            error: req.query.error,
            success: req.query.success
        });
    } catch (err) {
        console.error(err);
        res.redirect('/?error=Failed to load care logs');
    }
});

// Register a New Visitor / First-Timer
router.post('/first-timer/create', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    const { 
        fullName, phoneNumber, email, gender, address, invitedBy, 
        serviceAttended, prayerRequest, visitDate, status,
        occupation, maritalStatus, howHeard, socialMedia 
    } = req.body;

    try {
        await FirstTimer.create({
            fullName,
            phoneNumber: phoneNumber || null,
            email: email || null,
            gender: gender || null,
            address: address || null,
            invitedBy: invitedBy || null,
            serviceAttended: serviceAttended || null,
            prayerRequest: prayerRequest || null,
            visitDate: visitDate || new Date().toISOString().split('T')[0],
            status: status || 'pending',
            occupation: occupation || null,
            maritalStatus: maritalStatus || null,
            howHeard: howHeard || null,
            socialMedia: socialMedia || null,
            installationId: req.activeInstallationId
        });

        await AuditLog.create({
            action: 'FIRST_TIMER_CREATED',
            details: `Registered first timer: ${fullName}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/care?success=First-Timer registered successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/care?error=Failed to register first-timer');
    }
});

// Add a Follow-Up Log
router.post('/followup/create', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    const { notes, nextStep, reminderDate, firstTimerId, memberId } = req.body;

    try {
        await FollowUp.create({
            notes,
            nextStep: nextStep || '',
            reminderDate: reminderDate || null,
            userId: req.session.user.id,
            firstTimerId: firstTimerId || null,
            memberId: memberId || null
        });

        // Update first timer status to contacted if applicable
        if (firstTimerId) {
            await FirstTimer.update({ status: 'contacted' }, { where: { id: firstTimerId } });
        }

        await AuditLog.create({
            action: 'FOLLOW_UP_CREATED',
            details: `Added follow-up log. Next step: ${nextStep}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/care?success=Follow-up logged successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/care?error=Failed to log follow-up');
    }
});

// Convert First Timer to Full Member
router.post('/first-timer/:id/convert', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    try {
        const ft = await FirstTimer.findByPk(req.params.id);
        if (!ft) return res.redirect('/care?error=First-timer not found');

        // Create Member profile
        await Member.create({
            fullName: ft.fullName,
            email: ft.email,
            phoneNumber: ft.phoneNumber,
            gender: ft.gender,
            address: ft.address,
            classification: 'new_convert',
            status: 'active',
            installationId: req.activeInstallationId
        });

        // Update status to converted
        await ft.update({ status: 'converted' });

        await AuditLog.create({
            action: 'MEMBER_CONVERTED',
            details: `Converted first timer ${ft.fullName} to full member.`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/care?success=First-timer successfully added as a church member!');
    } catch (err) {
        console.error(err);
        res.redirect('/care?error=Failed to convert first-timer');
    }
});

module.exports = router;
