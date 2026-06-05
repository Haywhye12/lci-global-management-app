const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { Member, MemberAttendance, Attendance, AuditLog } = require('../models');
const { isAuthenticated, authorize } = require('../middleware/auth');
const { Op } = require('sequelize');

// GET Check-in Dashboard (Search & Check-in, QR check-in)
router.get('/checkin', isAuthenticated, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Fetch members for search
        const members = await Member.findAll({
            where: { installationId: req.activeInstallationId, status: 'active' },
            order: [['fullName', 'ASC']]
        });

        // Fetch today's check-ins
        const checkIns = await MemberAttendance.findAll({
            where: {
                installationId: req.activeInstallationId,
                serviceDate: today
            },
            include: [Member]
        });

        // Generate QR code URL pointing to scan check-in page
        const host = req.headers.host;
        const scanUrl = `${req.protocol}://${host}/attendance/scan-checkin`;
        const qrCodeUrl = await QRCode.toDataURL(scanUrl);

        res.render('attendance-checkin', {
            title: 'Attendance Check-in',
            members: members.map(m => m.get({ plain: true })),
            checkIns: checkIns.map(c => c.get({ plain: true })),
            today,
            qrCodeUrl,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.redirect('/attendance?error=Failed to load check-in page');
    }
});

// POST Manual Check-in
router.post('/checkin', isAuthenticated, async (req, res) => {
    const { memberId, serviceType, serviceDate } = req.body;
    const dateVal = serviceDate || new Date().toISOString().split('T')[0];

    try {
        // Prevent double check-in
        const existing = await MemberAttendance.findOne({
            where: {
                memberId,
                serviceDate: dateVal,
                serviceType
            }
        });

        if (existing) {
            return res.redirect('/attendance/checkin?error=Member already checked in for this service');
        }

        await MemberAttendance.create({
            memberId,
            serviceType,
            serviceDate: dateVal,
            checkInMethod: 'manual',
            installationId: req.activeInstallationId
        });

        res.redirect('/attendance/checkin?success=Member checked in successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/attendance/checkin?error=Failed to check in member');
    }
});

// GET Scan Check-in Page (Public page visited when scanning QR code)
router.get('/scan-checkin', async (req, res) => {
    try {
        // Display page prompting member to input phone or email to check in
        res.render('attendance-scan', {
            layout: false,
            title: 'LCI Branch Service Check-In',
            tenantName: req.tenant ? req.tenant.name : 'Leaders Church International'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading scan portal');
    }
});

// POST Scan Check-in Submit
router.post('/scan-checkin', async (req, res) => {
    const { contactInfo, serviceType } = req.body;
    const today = new Date().toISOString().split('T')[0];

    try {
        // Locate member by phone or email in active tenant
        const tenantId = req.tenant ? req.tenant.id : null;
        if (!tenantId) {
            return res.render('attendance-scan', { layout: false, error: 'Invalid branch portal.' });
        }

        const member = await Member.findOne({
            where: {
                installationId: tenantId,
                status: 'active',
                [Op.or]: [
                    { email: contactInfo },
                    { phoneNumber: contactInfo }
                ]
            }
        });

        if (!member) {
            return res.render('attendance-scan', { 
                layout: false, 
                error: 'Member not found. Please contact the church secretary to register.' 
            });
        }

        // Prevent duplicate check-in
        const existing = await MemberAttendance.findOne({
            where: {
                memberId: member.id,
                serviceDate: today,
                serviceType
            }
        });

        if (existing) {
            return res.render('attendance-scan', { 
                layout: false, 
                success: `Welcome! You are already checked in for today's ${serviceType} service.` 
            });
        }

        await MemberAttendance.create({
            memberId: member.id,
            serviceType,
            serviceDate: today,
            checkInMethod: 'qr',
            installationId: tenantId
        });

        await AuditLog.create({
            action: 'MEMBER_QR_CHECKIN',
            details: `Member checked in via QR: ${member.fullName}`,
            installationId: tenantId
        });

        res.render('attendance-scan', { 
            layout: false, 
            success: `Success! Welcome to church, ${member.fullName}. Your attendance has been logged.` 
        });
    } catch (err) {
        console.error(err);
        res.render('attendance-scan', { layout: false, error: 'Check-in failed due to server error.' });
    }
});

// GET Headcount Discrepancy Auditing View
router.get('/audit', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'global_auditor']), async (req, res) => {
    try {
        // Fetch legacy aggregate reports
        const records = await Attendance.findAll({
            where: { installationId: req.activeInstallationId },
            order: [['serviceDate', 'DESC']]
        });

        // For each record, query individual MemberAttendance count for that day & type
        const auditList = [];
        for (const rec of records) {
            const checkedInCount = await MemberAttendance.count({
                where: {
                    installationId: req.activeInstallationId,
                    serviceDate: rec.serviceDate,
                    serviceType: rec.serviceType
                }
            });

            const discrepancy = rec.manualHeadcount - checkedInCount;

            auditList.push({
                ...rec.get({ plain: true }),
                checkedInCount,
                discrepancy,
                hasDiscrepancy: discrepancy !== 0
            });
        }

        res.render('attendance-audit', {
            title: 'Attendance Discrepancy Audit',
            audits: auditList
        });
    } catch (err) {
        console.error(err);
        res.redirect('/attendance?error=Audit loading failed');
    }
});

module.exports = router;
