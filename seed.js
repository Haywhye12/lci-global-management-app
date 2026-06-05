const bcrypt = require('bcryptjs');
const {
    sequelize,
    Installation,
    User
} = require('./models');

async function seed() {
    try {
        const forceFlag = process.argv.includes('--force');
        
        // Safety check to prevent accidental dataloss
        if (!forceFlag) {
            const installationCount = await Installation.count().catch(() => 0);
            if (installationCount > 0) {
                console.log('ℹ️ Database already seeded. Skipping seed execution to protect your uploads.');
                console.log('💡 To force re-seeding and clear all data, run: node seed.js --force');
                process.exit(0);
            }
        }

        console.log('Wiping database and seeding production records...');
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
        await sequelize.sync({ force: true });
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('Database synced successfully.');

        // 1. Create Headquarters Installation (Tenant)
        const hq = await Installation.create({
            name: 'LCI Headquarters',
            location: 'Lekki, Lagos, Nigeria',
            subdomain: 'hq',
            timezone: 'Africa/Lagos',
            currency: 'NGN',
            contactEmail: 'hq@leaderschurchglobal.org',
            contactPhone: '+2348000000001',
            country: 'Nigeria',
            region: 'Lekki'
        });
        console.log('Created Headquarters installation.');

        // 2. Create Super Admin User
        const pHash = await bcrypt.hash('admin123', 10);
        await User.create({
            fullName: 'Super Admin',
            email: 'hailstormnews@gmail.com',
            password: pHash,
            role: 'superadmin',
            installationId: hq.id
        });
        console.log('Created Super Admin.');

        console.log('--- LOGIN DETAILS ---');
        console.log('Super Admin: hailstormnews@gmail.com / admin123');
        console.log('---------------------');
        process.exit(0);
    } catch (err) {
        console.error('Error seeding database:', err);
        process.exit(1);
    }
}

seed();
