const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Installation, AuditLog } = require('../models');
const { isAuthenticated, authorize } = require('../middleware/auth');
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
const handleLogoUpload = (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.redirect('/church-details?error=File too large! Maximum limit is 5MB.');
            }
            return res.redirect(`/church-details?error=${err.message}`);
        }
        next();
    });
};

// GET Church Details page
router.get('/', isAuthenticated, authorize(['superadmin', 'pastor', 'secretary']), async (req, res) => {
    try {
        const installation = await Installation.findByPk(req.activeInstallationId);
        res.render('church-details', {
            title: 'Church Details',
            installation: installation ? installation.get({ plain: true }) : null,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.redirect('/?error=Failed to load church details');
    }
});

// POST Update Church Details
router.post('/update', isAuthenticated, authorize(['superadmin', 'pastor', 'secretary']), handleLogoUpload, async (req, res) => {
    const { name, location, subdomain, timezone, currency, contactEmail, contactPhone, country, region } = req.body;

    try {
        const updateData = {
            name,
            location,
            subdomain: subdomain || null,
            timezone,
            currency,
            contactEmail,
            contactPhone,
            country,
            region
        };

        if (req.file) {
            const uploadedUrl = await uploadImage(req.file.path, 'lci_logos');
            updateData.logoUrl = uploadedUrl;
        }

        await Installation.update(updateData, { where: { id: req.activeInstallationId } });

        await AuditLog.create({
            action: 'CHURCH_DETAILS_UPDATED',
            details: `Updated church details for ${name}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/church-details?success=Church details updated successfully');
    } catch (err) {
        console.error('Church details update error:', err);
        res.redirect('/church-details?error=Failed to update church details');
    }
});

module.exports = router;
