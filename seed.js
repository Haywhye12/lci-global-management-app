const bcrypt = require('bcryptjs');
const {
    sequelize,
    Installation,
    User,
    Member,
    Transaction,
    Budget,
    Attendance,
    WeeklyReport,
    Department,
    DepartmentMembership,
    MediaItem,
    Event,
    Book,
    BranchPost,
    DashboardPost
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

        console.log('Wiping database and seeding mock records...');
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
        await sequelize.sync({ force: true });
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('Database synced successfully.');

        // 1. Create Installations (Tenants)
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

        const lagos = await Installation.create({
            name: 'LCI Lagos (Iju Branch)',
            location: 'Iju, Lagos, Nigeria',
            subdomain: 'lagos',
            timezone: 'Africa/Lagos',
            currency: 'NGN',
            contactEmail: 'lagos@leaderschurchglobal.org',
            contactPhone: '+2348000000002',
            country: 'Nigeria',
            region: 'Lagos State'
        });

        const london = await Installation.create({
            name: 'LCI London Branch',
            location: 'Southwark, London, UK',
            subdomain: 'london',
            timezone: 'Europe/London',
            currency: 'GBP',
            contactEmail: 'london@leaderschurchglobal.org',
            contactPhone: '+442079460192',
            country: 'United Kingdom',
            region: 'Greater London'
        });

        console.log('Created installations (tenants).');

        // 2. Create Users with RBAC Roles
        const pHash = await bcrypt.hash('admin123', 10);

        // Super Admin (Global)
        const superadmin = await User.create({
            fullName: 'Super Admin',
            email: 'hailstormnews@gmail.com',
            password: pHash,
            role: 'superadmin',
            installationId: hq.id
        });

        console.log('Created Users.');

        // 3. Create Departments in Lagos
        const choir = await Department.create({
            name: 'LCI Choir',
            description: 'Leaders Church International branch choir and worship team.',
            installationId: lagos.id,
            headId: null
        });

        const ushering = await Department.create({
            name: 'Ushering Department',
            description: 'Ushers and protocol officers assisting during services.',
            installationId: lagos.id,
            headId: null
        });

        console.log('Created Departments.');

        // 4. Create Members
        const familyId = '44520977-9976-4767-9388-144f8008d519';
        const m1 = await Member.create({
            fullName: 'James Sterling',
            email: 'james.sterling@gmail.com',
            phoneNumber: '+2348123456789',
            gender: 'male',
            address: '12 Iju Road, Ifako-Ijaiye, Lagos',
            status: 'active',
            classification: 'baptized',
            familyId: familyId,
            familyRole: 'Father',
            installationId: lagos.id
        });

        const m2 = await Member.create({
            fullName: 'Mary Sterling',
            email: 'mary.sterling@gmail.com',
            phoneNumber: '+2348123456780',
            gender: 'female',
            address: '12 Iju Road, Ifako-Ijaiye, Lagos',
            status: 'active',
            classification: 'baptized',
            familyId: familyId,
            familyRole: 'Mother',
            installationId: lagos.id
        });

        const m3 = await Member.create({
            fullName: 'Blessing Sterling',
            email: null,
            phoneNumber: null,
            gender: 'female',
            address: '12 Iju Road, Ifako-Ijaiye, Lagos',
            status: 'active',
            classification: 'visitor',
            familyId: familyId,
            familyRole: 'Child',
            installationId: lagos.id
        });

        const m4 = await Member.create({
            fullName: 'Brother Peter Alao',
            email: 'peter@gmail.com',
            phoneNumber: '+2348055556666',
            gender: 'male',
            address: 'Agege, Lagos',
            status: 'active',
            classification: 'worker',
            installationId: lagos.id
        });

        console.log('Created Members.');

        // 5. Create Transactions (Finance Ledger) & Budgets
        await Transaction.create({
            type: 'income',
            category: 'Tithes',
            amount: 750000.00,
            date: '2026-05-10',
            description: 'Sunday service tithes collection',
            installationId: lagos.id
        });

        await Transaction.create({
            type: 'income',
            category: 'Offerings',
            amount: 320000.00,
            date: '2026-05-10',
            description: 'Sunday service offerings',
            installationId: lagos.id
        });

        await Transaction.create({
            type: 'expense',
            category: 'Utilities',
            amount: 85000.00,
            date: '2026-05-15',
            description: 'Diesel for generator',
            installationId: lagos.id
        });

        await Transaction.create({
            type: 'expense',
            category: 'Welfare',
            amount: 50000.00,
            date: '2026-05-18',
            description: 'Support to bereaved family',
            installationId: lagos.id
        });

        // Budgets for May 2026
        await Budget.create({
            category: 'Utilities',
            amount: 100000.00,
            period: '2026-05',
            installationId: lagos.id
        });

        await Budget.create({
            category: 'Welfare',
            amount: 40000.00, // This will trigger an overspend warning because transactions = 50000
            period: '2026-05',
            installationId: lagos.id
        });

        console.log('Created transactions and budgets.');

        // 6. Create Attendance Trends Data
        await Attendance.create({
            serviceDate: '2026-05-03',
            serviceType: 'sunday',
            weekNumber: 1,
            male: 450,
            female: 520,
            child: 180,
            total: 1150,
            manualHeadcount: 1160,
            comments: 'Regular service',
            installationId: lagos.id
        });

        await Attendance.create({
            serviceDate: '2026-05-10',
            serviceType: 'sunday',
            weekNumber: 2,
            male: 490,
            female: 540,
            child: 180,
            total: 1210,
            manualHeadcount: 1210,
            comments: 'Worship service',
            installationId: lagos.id
        });

        console.log('Created attendance trends.');

        // 7. Create Weekly Reports (Report Approvals State Machine)
        await WeeklyReport.create({
            period: '2026-05',
            weekNumber: 1,
            status: 'approved',
            notes: 'First week of May reports.',
            isLate: false,
            version: 1,
            submittedById: null,
            pastorId: null,
            installationId: lagos.id
        });

        await WeeklyReport.create({
            period: '2026-05',
            weekNumber: 2,
            status: 'submitted',
            notes: 'Second week of May reports.',
            isLate: true, // Flagged late
            version: 1,
            submittedById: null,
            installationId: lagos.id
        });

        console.log('Created reports.');

        // 8. Create Events
        await Event.create({
            title: 'Youth Fire Conference 2026',
            description: 'Annual gathering of LCI global youths for spiritual empowerment.',
            eventDate: new Date('2026-06-15T09:00:00Z'),
            location: 'Lagos HQ Auditorium / YouTube Live',
            livestreamLink: 'https://youtube.com/live/placeholder',
            installationId: lagos.id
        });

        // 9. Create Sermon Media Items
        await MediaItem.create({
            title: 'Walking in Supernatural Authority',
            description: 'Sunday sermon by Pastor Bobani on operating in divine faith.',
            category: 'audio',
            fileUrl: '/uploads/sermon_1.mp3',
            permissions: 'downloadable',
            installationId: lagos.id
        });

        console.log('Created Events and Media.');

        // 10. Seed E-Books Library
        await Book.create({
            title: 'The Art of Leadership',
            author: 'Bishop Dag Heward-Mills',
            description: 'The standard manual on spiritual leadership dynamics, vision implementation, and church governance.',
            pdfUrl: 'https://res.cloudinary.com/dcm5fmmxq/image/upload/v1/lci_books_pdf/placeholder.pdf',
            coverUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&q=80&w=200&h=300',
            installationId: null // Global resource
        });

        await Book.create({
            title: 'Loyalty and Disloyalty',
            author: 'Bishop Dag Heward-Mills',
            description: 'An invaluable classic dealing with building trust, unity, and structural loyalty in church departments.',
            pdfUrl: 'https://res.cloudinary.com/dcm5fmmxq/image/upload/v1/lci_books_pdf/placeholder.pdf',
            coverUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=200&h=300',
            installationId: lagos.id // Lagos only
        });

        // 11. Seed Branch community bulletin posts
        await BranchPost.create({
            title: 'Welcome to our New Library and Feed!',
            content: 'Dear Lagos branch members, we are excited to launch our E-Books Library and Community Feed! You can now download PDFs uploaded by pastors, and post updates, sermon notes, testimonies, or encouragement items right here.',
            authorName: 'Pastor Ayomide Bobani',
            userId: null,
            installationId: lagos.id
        });

        await BranchPost.create({
            title: 'Youth Fire Conference 2026 Registration Open',
            content: 'Register for the upcoming Youth Fire Conference today. Let us prepare for supernatural transformation and empowerment.',
            authorName: 'Sister Sarah Jenkins',
            userId: null,
            installationId: lagos.id
        });

        // 12. Seed Dashboard News Feed Posts (Image-only updates)
        await DashboardPost.create({
            content: 'Blessed to see such amazing growth in our ushering team training session today! Moving from strength to strength.',
            imageUrl: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&q=80&w=400&h=250',
            authorName: 'Deacon John Doe',
            userId: null,
            installationId: lagos.id
        });

        await DashboardPost.create({
            content: 'Reminder: Midweek Miracle Service starts by 6:00 PM this Wednesday. Come expectant and bring a friend! 🙏✨',
            imageUrl: null,
            authorName: 'Pastor Ayomide Bobani',
            userId: null,
            installationId: lagos.id
        });

        console.log('Created Books and Bulletin Feed mock records.');

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
