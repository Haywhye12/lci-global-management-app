const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const isConfigured = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name' &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_KEY !== 'your_api_key' &&
    process.env.CLOUDINARY_API_SECRET &&
    process.env.CLOUDINARY_API_SECRET !== 'your_api_secret'
);

if (isConfigured) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    console.log('☁️ Cloudinary configured successfully.');
} else {
    console.warn('⚠️ WARNING: Placeholder or missing Cloudinary credentials. Running in local storage fallback mode.');
}

/**
 * Uploads a local file to Cloudinary. Falls back to a local public upload path if credentials are missing.
 * @param {string} localFilePath - Path to the temp file on disk.
 * @param {string} folder - Target folder in Cloudinary.
 * @returns {Promise<string>} The uploaded image URL (Cloudinary secure_url or local relative url).
 */
async function uploadImage(localFilePath, folder = 'lci_uploads') {
    if (!localFilePath) {
        throw new Error('No file path provided for upload');
    }

    if (isConfigured) {
        try {
            const result = await cloudinary.uploader.upload(localFilePath, {
                folder: folder,
                resource_type: 'auto'
            });
            // Try to delete the temp file after successful Cloudinary upload
            try {
                fs.unlinkSync(localFilePath);
            } catch (err) {
                console.error('Failed to delete temp file:', err);
            }
            return result.secure_url;
        } catch (err) {
            console.error('Cloudinary upload failed, falling back to local URL:', err);
            // Fall through to local fallback
        }
    }

    // Local fallback: Move file from temporary location to permanent public uploads directory if needed
    const filename = path.basename(localFilePath);
    const permanentDir = path.join(__dirname, '../public/uploads');
    
    // Ensure directory exists
    if (!fs.existsSync(permanentDir)) {
        fs.mkdirSync(permanentDir, { recursive: true });
    }

    const permanentPath = path.join(permanentDir, filename);
    
    if (localFilePath !== permanentPath && fs.existsSync(localFilePath)) {
        try {
            fs.renameSync(localFilePath, permanentPath);
        } catch (err) {
            console.error('Failed to move local upload file:', err);
        }
    }

    return `/uploads/${filename}`;
}

module.exports = {
    cloudinary,
    isConfigured,
    uploadImage
};
