const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Book, BranchPost, User, AuditLog } = require('../models');
const { isAuthenticated } = require('../middleware/auth');
const { uploadImage } = require('../config/cloudinary');

// Ensure upload directory exists for initial Multer write
const tempUploadDir = path.join(__dirname, '../public/uploads/temp');
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Multer temporary disk storage config for PDF uploads & cover images
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
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit for PDFs
    fileFilter: (req, file, cb) => {
        const filetypes = /pdf|jpeg|jpg|png|webp/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname || mimetype) return cb(null, true);
        cb(new Error("Error: Unsupported file format!"));
    }
});

// Middleware to gracefully catch Multer errors during book uploads
const handleBookUpload = (req, res, next) => {
    upload.fields([
        { name: 'bookPdf', maxCount: 1 },
        { name: 'coverImage', maxCount: 1 }
    ])(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.redirect('/library?error=File too large! Maximum limit is 15MB.');
            }
            return res.redirect(`/library?error=${err.message}`);
        }
        next();
    });
};

// View Books Library & Bulletin Feed
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const { Op } = require('sequelize');
        
        // Fetch books: Either global (installationId is null) or specific to active branch
        const books = await Book.findAll({
            where: {
                [Op.or]: [
                    { installationId: null },
                    { installationId: req.activeInstallationId }
                ]
            },
            order: [['createdAt', 'DESC']]
        });

        // Fetch Branch bulletin posts scoped only to this branch
        const posts = await BranchPost.findAll({
            where: { installationId: req.activeInstallationId },
            include: [{ model: User, attributes: ['fullName', 'profilePicture', 'role'] }],
            order: [['createdAt', 'DESC']]
        });

        const isUploader = ['superadmin', 'pastor', 'admin'].includes(req.session.user.role);

        res.render('library', {
            title: 'Books & Bulletin Feed',
            books: books.map(b => b.get({ plain: true })),
            posts: posts.map(p => p.get({ plain: true })),
            isUploader,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Failed to load library:', err);
        res.redirect('/?error=Failed to load library and community feed');
    }
});

// Upload Book (PDF & Cover) - Superadmin & Pastor only
router.post('/books/upload', isAuthenticated, handleBookUpload, async (req, res) => {
    const isAuthorized = ['superadmin', 'pastor', 'admin'].includes(req.session.user.role);
    if (!isAuthorized) {
        return res.redirect('/library?error=Access Denied! Only pastors and admins can upload books.');
    }

    const { title, author, description, isGlobal } = req.body;

    if (!req.files || !req.files.bookPdf) {
        return res.redirect('/library?error=Please select a PDF book to upload.');
    }

    try {
        // Upload PDF to Cloudinary (using uploadImage, which handles pdf automatically with resource_type: auto)
        const pdfFile = req.files.bookPdf[0];
        const pdfUrl = await uploadImage(pdfFile.path, 'lci_books_pdf');

        // Optional Cover Image
        let coverUrl = '/images/book-cover.jpg';
        if (req.files.coverImage) {
            const coverFile = req.files.coverImage[0];
            coverUrl = await uploadImage(coverFile.path, 'lci_books_covers');
        }

        const book = await Book.create({
            title,
            author: author || 'LCI Global',
            description,
            pdfUrl,
            coverUrl,
            uploadedBy: req.session.user.id,
            installationId: isGlobal === 'true' ? null : req.activeInstallationId
        });

        await AuditLog.create({
            action: 'BOOK_UPLOADED',
            details: `Uploaded book: "${title}" by ${author}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/library?success=Book uploaded successfully!');
    } catch (err) {
        console.error('Failed to upload book:', err);
        res.redirect('/library?error=Server error uploading book.');
    }
});

// Create Bulletin Board / Feed Post - Any member can post
router.post('/posts/create', isAuthenticated, async (req, res) => {
    const { title, content } = req.body;

    if (!content || content.trim() === '') {
        return res.redirect('/library?error=Content cannot be empty.');
    }

    try {
        await BranchPost.create({
            title: title || 'Bulletin Note',
            content,
            authorName: req.session.user.fullName,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        await AuditLog.create({
            action: 'FEED_POST_CREATED',
            details: `Created new community post: "${title || 'Untitled'}"`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/library?success=Community post published successfully!');
    } catch (err) {
        console.error('Failed to create community post:', err);
        res.redirect('/library?error=Failed to publish post.');
    }
});

module.exports = router;
