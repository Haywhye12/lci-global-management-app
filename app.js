const express = require('express');
const { Op } = require('sequelize');
const { engine } = require('express-handlebars');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const {
    sequelize, Installation, User, Department, Member,
    Attendance, Finance, Transaction, Budget, WeeklyReport,
    ReportSnapshot, FirstTimer, FollowUp, DutyRoster,
    Event, EventRegistration, MediaItem, AuditLog, MemberAttendance, DashboardPost,
    MemberTransfer, DepartmentMembership, DepartmentReport, TrainingLog, EventVolunteer, NotificationLog, Book, BranchPost
} = require('./models');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const peopleRoutes = require('./routes/people');
const departmentRoutes = require('./routes/departments');
const exportRoutes = require('./routes/export');
const careRoutes = require('./routes/care');
const libraryRoutes = require('./routes/library');
const attendanceRoutes = require('./routes/attendance');
const churchRoutes = require('./routes/church');
const { isAuthenticated, authorize } = require('./middleware/auth');
const multitenancy = require('./middleware/multitenancy');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// Handlebars Setup
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    helpers: {
        eq: (a, b) => a === b,
        ne: (a, b) => a !== b,
        or: (a, b) => a || b,
        and: (a, b) => a && b,
        includes: (arr, val) => Array.isArray(arr) ? arr.includes(val) : String(arr).includes(String(val)),
        // Check if user role is in a comma-separated list e.g. {{#if (hasRole user.role 'superadmin,pastor,global_auditor')}}
        hasRole: (role, list) => list.split(',').map(r => r.trim()).includes(role),
        initials: (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase() : '?',
        formatDate: (date) => date ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        formatCurrency: (amount) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount || 0)
    }
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const SequelizeStore = require('connect-session-sequelize')(session.Store);
const sessionStore = new SequelizeStore({
    db: sequelize,
    tableName: 'Sessions',
    checkExpirationInterval: 15 * 60 * 1000, // Cleanup expired sessions every 15 minutes
    expiration: 24 * 60 * 60 * 1000 // Sessions expire in 24 hours
});

app.use(session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: null // Session cookie (expires when browser is closed)
    }
}));

// Sync the session store table
sessionStore.sync();

// Dynamically set session cookie domain to share session across tenant subdomains
app.use((req, res, next) => {
    const host = req.headers.host ? req.headers.host.split(':')[0] : '';
    if (host) {
        if (host === 'localhost' || host.endsWith('.localhost')) {
            // Do not set session cookie domain to '.localhost' as modern browsers reject wildcard cookies on localhost.
            // Leaving it undefined scopes the session cookie to the current exact host (e.g. lagos.localhost or localhost).
            req.session.cookie.domain = undefined;
        } else if (host.endsWith('.up.railway.app')) {
            const match = host.match(/([a-zA-Z0-9\-]+)\.up\.railway\.app$/);
            if (match) {
                req.session.cookie.domain = '.' + match[0];
            }
        } else {
            const parts = host.split('.');
            if (parts.length >= 2) {
                const baseDomain = parts.slice(-2).join('.');
                req.session.cookie.domain = '.' + baseDomain;
            }
        }
    }
    next();
});

// Multi-Tenancy Middleware — resolves subdomain to tenant branch
app.use(multitenancy);

// Global Context Middleware
app.use((req, res, next) => {
    res.locals.path = req.path;
    next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/people', peopleRoutes);
app.use('/export', exportRoutes);
app.use('/care', careRoutes);
app.use('/attendance', attendanceRoutes);
app.use('/library', libraryRoutes);
app.use('/church-details', churchRoutes);

// Super Admin Routes
app.get('/superadmin/installations', isAuthenticated, authorize('superadmin'), async (req, res) => {
    try {
        const installations = await Installation.findAll({
            include: [
                { model: User, attributes: ['id'] },
                { model: Member, attributes: ['id'] },
                { model: Department, attributes: ['id'] }
            ],
            order: [['name', 'ASC']]
        });
        
        const instData = installations.map(i => {
            const data = i.get({ plain: true });
            data.userCount = data.Users ? data.Users.length : 0;
            data.memberCount = data.Members ? data.Members.length : 0;
            data.departmentCount = data.Departments ? data.Departments.length : 0;
            return data;
        });

        res.render('superadmin-dashboard', { 
            title: 'All Installations Overview', 
            installations: instData,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.render('error', { message: 'Failed to load installations' });
    }
});

app.post('/superadmin/installations/create', isAuthenticated, authorize('superadmin'), async (req, res) => {
    try {
        const { name, location, status } = req.body;
        await Installation.create({ name, location, status });
        res.redirect('/superadmin/installations?success=Installation created successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/superadmin/installations?error=Failed to create installation');
    }
});

app.get('/superadmin/switch-installation/:id', isAuthenticated, authorize('superadmin'), async (req, res) => {
    try {
        if (req.params.id === 'clear') {
            delete req.session.selectedInstallationId;
            delete req.session.selectedInstallationName;
            return res.redirect('/superadmin/installations');
        }

        const inst = await Installation.findByPk(req.params.id);
        if (inst) {
            req.session.selectedInstallationId = inst.id;
            req.session.selectedInstallationName = inst.name;
        }
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.redirect('/superadmin/installations');
    }
});

app.post('/superadmin/installations/:id/delete', isAuthenticated, authorize('superadmin'), async (req, res) => {
    const { id } = req.params;
    
    // Safety check: Cannot delete your own assigned installation
    if (id === req.session.user.installationId) {
        return res.redirect('/superadmin/installations?error=You cannot delete the installation to which your admin account belongs.');
    }
    
    const transaction = await sequelize.transaction();
    try {
        const inst = await Installation.findByPk(id);
        if (!inst) {
            await transaction.rollback();
            return res.redirect('/superadmin/installations?error=Installation not found');
        }
        
        // Fetch child record IDs
        const userIds = (await User.findAll({ where: { installationId: id }, attributes: ['id'] })).map(u => u.id);
        const memberIds = (await Member.findAll({ where: { installationId: id }, attributes: ['id'] })).map(m => m.id);
        const departmentIds = (await Department.findAll({ where: { installationId: id }, attributes: ['id'] })).map(d => d.id);
        const reportIds = (await WeeklyReport.findAll({ where: { installationId: id }, attributes: ['id'] })).map(r => r.id);
        const firstTimerIds = (await FirstTimer.findAll({ where: { installationId: id }, attributes: ['id'] })).map(f => f.id);
        const eventIds = (await Event.findAll({ where: { installationId: id }, attributes: ['id'] })).map(e => e.id);
        
        // Helper to check and execute dynamic deletes to avoid dialect empty-array error
        const deleteOrCondition = async (model, fieldsMap) => {
            const orConditions = [];
            for (const [field, ids] of Object.entries(fieldsMap)) {
                if (ids && ids.length > 0) {
                    orConditions.push({ [field]: ids });
                }
            }
            if (orConditions.length > 0) {
                await model.destroy({ where: { [Op.or]: orConditions }, transaction });
            }
        };
        
        // 1. FollowUp
        await deleteOrCondition(FollowUp, { firstTimerId: firstTimerIds, memberId: memberIds, userId: userIds });
        
        // 2. FirstTimer
        await FirstTimer.destroy({ where: { installationId: id }, transaction });
        
        // 3. EventRegistration
        await deleteOrCondition(EventRegistration, { eventId: eventIds, memberId: memberIds, userId: userIds });
        
        // 4. EventVolunteer
        await deleteOrCondition(EventVolunteer, { eventId: eventIds, memberId: memberIds, userId: userIds });
        
        // 5. Event
        await Event.destroy({ where: { installationId: id }, transaction });
        
        // 6. MemberAttendance
        const memberAttOr = [{ installationId: id }];
        if (memberIds.length > 0) memberAttOr.push({ memberId: memberIds });
        await MemberAttendance.destroy({ where: { [Op.or]: memberAttOr }, transaction });
        
        // 7. MemberTransfer
        const transferOr = [{ sourceInstallationId: id }, { destinationInstallationId: id }];
        if (memberIds.length > 0) transferOr.push({ memberId: memberIds });
        if (userIds.length > 0) transferOr.push({ requestedById: userIds });
        await MemberTransfer.destroy({ where: { [Op.or]: transferOr }, transaction });
        
        // 8. Member
        await Member.destroy({ where: { installationId: id }, transaction });
        
        // 9. ReportSnapshot
        const snapshotOr = [];
        if (reportIds.length > 0) snapshotOr.push({ reportId: reportIds });
        if (userIds.length > 0) snapshotOr.push({ changedById: userIds });
        if (snapshotOr.length > 0) {
            await ReportSnapshot.destroy({ where: { [Op.or]: snapshotOr }, transaction });
        }
        
        // 10. WeeklyReport
        const reportOr = [{ installationId: id }];
        if (userIds.length > 0) {
            reportOr.push({ submittedById: userIds });
            reportOr.push({ pastorId: userIds });
        }
        await WeeklyReport.destroy({ where: { [Op.or]: reportOr }, transaction });
        
        // 11. DepartmentReport
        const deptRepOr = [];
        if (departmentIds.length > 0) deptRepOr.push({ departmentId: departmentIds });
        if (userIds.length > 0) deptRepOr.push({ submittedById: userIds });
        if (deptRepOr.length > 0) {
            await DepartmentReport.destroy({ where: { [Op.or]: deptRepOr }, transaction });
        }
        
        // 12. DepartmentMembership
        const membershipOr = [];
        if (departmentIds.length > 0) membershipOr.push({ departmentId: departmentIds });
        if (userIds.length > 0) membershipOr.push({ userId: userIds });
        if (membershipOr.length > 0) {
            await DepartmentMembership.destroy({ where: { [Op.or]: membershipOr }, transaction });
        }
        
        // 13. Department
        await Department.destroy({ where: { installationId: id }, transaction });
        
        // 14. TrainingLog
        if (userIds.length > 0) {
            await TrainingLog.destroy({ where: { userId: userIds }, transaction });
        }
        
        // 15. DutyRoster
        const rosterOr = [{ installationId: id }];
        if (userIds.length > 0) rosterOr.push({ userId: userIds });
        await DutyRoster.destroy({ where: { [Op.or]: rosterOr }, transaction });
        
        // 16. BranchPost
        const bPostOr = [{ installationId: id }];
        if (userIds.length > 0) bPostOr.push({ userId: userIds });
        await BranchPost.destroy({ where: { [Op.or]: bPostOr }, transaction });
        
        // 17. DashboardPost
        const dPostOr = [{ installationId: id }];
        if (userIds.length > 0) dPostOr.push({ userId: userIds });
        await DashboardPost.destroy({ where: { [Op.or]: dPostOr }, transaction });
        
        // 18. Book
        const bookOr = [{ installationId: id }];
        if (userIds.length > 0) bookOr.push({ uploadedBy: userIds });
        await Book.destroy({ where: { [Op.or]: bookOr }, transaction });
        
        // 19. AuditLog
        const auditOr = [{ installationId: id }];
        if (userIds.length > 0) auditOr.push({ userId: userIds });
        await AuditLog.destroy({ where: { [Op.or]: auditOr }, transaction });
        
        // 20. NotificationLog
        await NotificationLog.destroy({ where: { installationId: id }, transaction });
        
        // 21. Transaction
        await Transaction.destroy({ where: { installationId: id }, transaction });
        
        // 22. Budget
        await Budget.destroy({ where: { installationId: id }, transaction });
        
        // 23. Finance
        await Finance.destroy({ where: { installationId: id }, transaction });
        
        // 24. Attendance
        await Attendance.destroy({ where: { installationId: id }, transaction });
        
        // 25. User
        await User.destroy({ where: { installationId: id }, transaction });
        
        // 26. Installation
        await inst.destroy({ transaction });
        
        await transaction.commit();
        
        // Clear switched session if it was the deleted installation
        if (req.session.selectedInstallationId === id) {
            delete req.session.selectedInstallationId;
            delete req.session.selectedInstallationName;
        }
        
        res.redirect('/superadmin/installations?success=Installation deleted successfully');
    } catch (err) {
        await transaction.rollback();
        console.error('Failed to delete installation:', err);
        res.redirect(`/superadmin/installations?error=Failed to delete installation: ${err.message}`);
    }
});

const multer = require('multer');
const { uploadImage } = require('./config/cloudinary');

// Ensure temporary uploads directory exists
const tempUploadDir = path.join(__dirname, 'public/uploads/temp');
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Multer temporary disk storage config for feed posts
const feedStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempUploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'feed-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const feedUpload = multer({ 
    storage: feedStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        // PERMIT ONLY PICTURES (IMAGES), STRICTLY BLOCK VIDEOS
        const filetypes = /jpeg|jpg|png|gif|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error("Error: News feed only supports image uploads! Videos and other files are blocked."));
    }
});

// Middleware to gracefully catch Multer errors for feed posts
const handleFeedUpload = (req, res, next) => {
    feedUpload.single('feedImage')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.redirect('/?error=File too large! Maximum image limit is 5MB.');
            }
            return res.redirect(`/?error=${err.message}`);
        }
        next();
    });
};

app.get('/', isAuthenticated, async (req, res) => {
    if (req.session.user.role === 'superadmin' && !req.session.selectedInstallationId) {
        return res.redirect('/superadmin/installations');
    }
    
    try {
        const activeInstId = req.activeInstallationId;
        const inst = await Installation.findByPk(activeInstId);
        const currency = inst ? inst.currency : 'NGN';

        const feedPosts = await DashboardPost.findAll({
            where: { installationId: activeInstId },
            include: [{ model: User, attributes: ['fullName', 'profilePicture', 'role'] }],
            order: [['createdAt', 'DESC']]
        });

        // 1. Calculate stats dynamically
        // Average Attendance:
        const attendances = await Attendance.findAll({
            where: { installationId: activeInstId },
            order: [['serviceDate', 'ASC']]
        });
        const avgAttendance = attendances.length > 0
            ? Math.round(attendances.reduce((sum, a) => sum + a.total, 0) / attendances.length)
            : 0;

        // Gross Monthly Income:
        const transactions = await Transaction.findAll({
            where: { installationId: activeInstId, type: 'income' }
        });
        const grossIncome = transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        const formattedIncome = currency === 'GBP'
            ? grossIncome.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 })
            : grossIncome.toLocaleString('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 });

        // First Timers:
        const firstTimersCount = await FirstTimer.count({
            where: { installationId: activeInstId }
        });

        // Report Status:
        const latestReport = await WeeklyReport.findOne({
            where: { installationId: activeInstId },
            order: [['createdAt', 'DESC']]
        });
        const reportStatus = latestReport ? latestReport.status.toUpperCase() : 'NO DATA';

        // 2. Attendance Trends Chart data:
        const chartLabels = attendances.slice(-6).map(a => {
            const date = new Date(a.serviceDate);
            return date.toLocaleString('default', { month: 'short' }) + ' ' + date.getDate();
        });
        const chartData = attendances.slice(-6).map(a => a.total);

        // 3. Recent Weekly Reports Table:
        const recentReports = await WeeklyReport.findAll({
            where: { installationId: activeInstId },
            order: [['createdAt', 'DESC']],
            limit: 5
        });

        const formattedReports = [];
        for (const report of recentReports) {
            const att = await Attendance.findOne({
                where: {
                    installationId: activeInstId,
                    weekNumber: report.weekNumber,
                    serviceDate: {
                        [Op.like]: `${report.period}%`
                    }
                }
            });
            const attendanceTotal = att ? att.total : 0;
            
            let incomeTotal = 0;
            if (att && att.serviceDate) {
                const dateObj = new Date(att.serviceDate);
                const startOfWeek = new Date(dateObj);
                startOfWeek.setDate(dateObj.getDate() - dateObj.getDay());
                const endOfWeek = new Date(dateObj);
                endOfWeek.setDate(dateObj.getDate() + (6 - dateObj.getDay()));

                const startStr = startOfWeek.toISOString().split('T')[0];
                const endStr = endOfWeek.toISOString().split('T')[0];

                const weeklyTransactions = await Transaction.findAll({
                    where: {
                        installationId: activeInstId,
                        type: 'income',
                        date: {
                            [Op.between]: [startStr, endStr]
                        }
                    }
                });
                incomeTotal = weeklyTransactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
            }

            formattedReports.push({
                periodName: `Week ${report.weekNumber} - ${new Date(report.period + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}`,
                attendance: attendanceTotal.toLocaleString(),
                income: currency === 'GBP'
                    ? incomeTotal.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 })
                    : incomeTotal.toLocaleString('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }),
                status: report.status.toUpperCase()
            });
        }

        // 4. Monthly Target Progress:
        const monthlyTarget = 1500;
        const progressPercentage = avgAttendance > 0 ? Math.min(Math.round((avgAttendance / monthlyTarget) * 100), 100) : 0;

        res.render('dashboard', { 
            title: 'Dashboard',
            feedPosts: feedPosts.map(p => p.get({ plain: true })),
            stats: {
                avgAttendance: avgAttendance.toLocaleString(),
                grossIncome: formattedIncome,
                firstTimers: firstTimersCount,
                reportStatus: reportStatus,
                targetPercentage: progressPercentage,
                targetMessage: progressPercentage > 0 
                    ? `You've reached ${progressPercentage}% of your attendance goal.`
                    : `No attendance goal progress yet.`
            },
            chartLabels: JSON.stringify(chartLabels.length > 0 ? chartLabels : ['No Data']),
            chartData: JSON.stringify(chartData.length > 0 ? chartData : [0]),
            recentReports: formattedReports,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        res.render('dashboard', { 
            title: 'Dashboard', 
            feedPosts: [], 
            stats: {
                avgAttendance: '0',
                grossIncome: '₦0',
                firstTimers: 0,
                reportStatus: 'ERROR',
                targetPercentage: 0,
                targetMessage: 'Failed to load targets.'
            },
            chartLabels: JSON.stringify(['Error']),
            chartData: JSON.stringify([0]),
            recentReports: [],
            error: 'Failed to load dashboard data.' 
        });
    }
});

// Handle Dashboard News Feed Image-Only Posts
app.post('/dashboard/post', isAuthenticated, handleFeedUpload, async (req, res) => {
    const { content } = req.body;

    if (!content || content.trim() === '') {
        return res.redirect('/?error=Post content cannot be empty.');
    }

    try {
        let imageUrl = null;

        // If an image is selected, upload to Cloudinary/Local
        if (req.file) {
            imageUrl = await uploadImage(req.file.path, 'lci_dashboard_feed');
        }

        await DashboardPost.create({
            content,
            imageUrl,
            authorName: req.session.user.fullName,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        await AuditLog.create({
            action: 'DASHBOARD_FEED_POSTED',
            details: `Created new dashboard news post: "${content.substring(0, 30)}..."`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/?success=Post published to News Feed successfully!');
    } catch (err) {
        console.error('Dashboard feed post error:', err);
        res.redirect('/?error=Failed to publish post to News Feed.');
    }
});

app.get('/attendance', isAuthenticated, async (req, res) => {
    try {
        let year, month;
        if (req.query.month) {
            const parts = req.query.month.split('-');
            if (parts.length === 2) {
                year = parseInt(parts[0], 10);
                month = parseInt(parts[1], 10);
            }
        }
        
        if (!year || !month || isNaN(year) || isNaN(month)) {
            const now = new Date();
            year = now.getFullYear();
            month = now.getMonth() + 1;
        }

        const paddedMonth = month.toString().padStart(2, '0');
        const startDate = `${year}-${paddedMonth}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];

        const tempDate = new Date(year, month - 1, 1);
        const monthName = tempDate.toLocaleString('default', { month: 'long' });
        
        const date = new Date(year, month - 1, 1);
        const weeks = [];
        let count = 0;
        while (date.getMonth() === month - 1) {
            if (date.getDay() === 0) {
                count++;
                weeks.push(count);
            }
            date.setDate(date.getDate() + 1);
        }

        const attendanceRecords = await Attendance.findAll({
            where: {
                installationId: req.activeInstallationId,
                serviceDate: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        const sundaysMap = {};
        const weekdaysMap = {};
        const specials = [];

        attendanceRecords.forEach(rec => {
            const plain = rec.get({ plain: true });
            if (plain.serviceType === 'sunday') {
                sundaysMap[plain.weekNumber] = plain;
            } else if (plain.serviceType === 'weekday') {
                weekdaysMap[plain.weekNumber] = plain;
            } else if (plain.serviceType === 'special') {
                specials.push(plain);
            }
        });

        const weeksData = weeks.map(w => {
            return {
                weekNumber: w,
                sunday: sundaysMap[w] || { male: '', female: '', child: '', total: '', specialProgram: '', comments: '', testimony: '' },
                weekday: weekdaysMap[w] || { total: '', specialProgram: '', comments: '', testimony: '' }
            };
        });

        res.render('attendance', { 
            title: 'Attendance',
            weeks: weeksData,
            specials,
            month: paddedMonth,
            year,
            monthName
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { message: 'Failed to load attendance records' });
    }
});

app.get('/finance', isAuthenticated, async (req, res) => {
    try {
        let year, month;
        if (req.query.month) {
            const parts = req.query.month.split('-');
            if (parts.length === 2) {
                year = parseInt(parts[0], 10);
                month = parseInt(parts[1], 10);
            }
        }
        
        if (!year || !month || isNaN(year) || isNaN(month)) {
            const now = new Date();
            year = now.getFullYear();
            month = now.getMonth() + 1;
        }

        const paddedMonth = month.toString().padStart(2, '0');
        const periodStr = `${year}-${paddedMonth}`;

        const tempDate = new Date(year, month - 1, 1);
        const monthName = tempDate.toLocaleString('default', { month: 'long' });
        
        const date = new Date(year, month - 1, 1);
        const weeks = [];
        let count = 0;
        while (date.getMonth() === month - 1) {
            if (date.getDay() === 0) {
                count++;
                weeks.push(count);
            }
            date.setDate(date.getDate() + 1);
        }

        const financeRecords = await Finance.findAll({
            where: {
                installationId: req.activeInstallationId,
                period: periodStr
            }
        });

        const sundaysMap = {};
        const weekdaysMap = {};
        const specialsMap = {};
        let expenditures = {
            expElectricity: '',
            expStationery: '',
            expPastor: '',
            expWelfare: '',
            expMisc: '',
            totalExpenditure: ''
        };

        financeRecords.forEach(rec => {
            const plain = rec.get({ plain: true });
            if (plain.weekNumber === 0) {
                expenditures = plain;
            } else {
                if (plain.serviceType === 'sunday') {
                    sundaysMap[plain.weekNumber] = plain;
                } else if (plain.serviceType === 'weekday') {
                    weekdaysMap[plain.weekNumber] = plain;
                } else if (plain.serviceType === 'special') {
                    specialsMap[plain.weekNumber] = plain;
                }
            }
        });

        const weeksData = weeks.map(w => {
            return {
                weekNumber: w,
                sunday: sundaysMap[w] || { tithes: '', offering: '', specialCollection: '', totalIncome: '' },
                weekday: weekdaysMap[w] || { tithes: '', offering: '', specialCollection: '', totalIncome: '' },
                special: specialsMap[w] || { tithes: '', offering: '', specialCollection: '', totalIncome: '' }
            };
        });

        res.render('finance', { 
            title: 'Finance',
            weeks: weeksData,
            expenditures,
            month: paddedMonth,
            year,
            monthName
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { message: 'Failed to load finance records' });
    }
});

// Helper functions for date calculations
function getNthSundayDate(year, month, weekNumber) {
    const date = new Date(year, month - 1, 1);
    let count = 0;
    while (date.getMonth() === month - 1) {
        if (date.getDay() === 0) {
            count++;
            if (count === weekNumber) {
                return date.toISOString().split('T')[0];
            }
        }
        date.setDate(date.getDate() + 1);
    }
    return null;
}

function getNthWeekdayDate(year, month, weekNumber) {
    const date = new Date(year, month - 1, 1);
    let count = 0;
    while (date.getMonth() === month - 1) {
        if (date.getDay() === 3) { // Wednesday
            count++;
            if (count === weekNumber) {
                return date.toISOString().split('T')[0];
            }
        }
        date.setDate(date.getDate() + 1);
    }
    const sun = getNthSundayDate(year, month, weekNumber);
    if (sun) {
        const d = new Date(sun);
        d.setDate(d.getDate() - 4);
        return d.toISOString().split('T')[0];
    }
    return null;
}

app.post('/attendance/save', isAuthenticated, async (req, res) => {
    try {
        const { month: monthStr, sundays, weekdays, specials } = req.body;
        if (!monthStr) {
            return res.status(400).json({ success: false, message: 'Month is required' });
        }

        const parts = monthStr.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const paddedMonth = month.toString().padStart(2, '0');
        const activeInstallationId = req.activeInstallationId;

        const startDate = `${year}-${paddedMonth}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];

        await Attendance.destroy({
            where: {
                installationId: activeInstallationId,
                serviceDate: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        const recordsToCreate = [];

        if (Array.isArray(sundays)) {
            sundays.forEach(sun => {
                const date = getNthSundayDate(year, month, parseInt(sun.weekNumber, 10));
                if (date) {
                    const male = parseInt(sun.male, 10) || 0;
                    const female = parseInt(sun.female, 10) || 0;
                    const child = parseInt(sun.child, 10) || 0;
                    recordsToCreate.push({
                        serviceDate: date,
                        serviceType: 'sunday',
                        weekNumber: parseInt(sun.weekNumber, 10),
                        male,
                        female,
                        child,
                        total: male + female + child,
                        specialProgram: sun.specialProgram || '',
                        comments: sun.comments || '',
                        testimony: sun.testimony || '',
                        installationId: activeInstallationId
                    });
                }
            });
        }

        if (Array.isArray(weekdays)) {
            weekdays.forEach(wk => {
                const date = getNthWeekdayDate(year, month, parseInt(wk.weekNumber, 10));
                if (date) {
                    const total = parseInt(wk.total, 10) || 0;
                    recordsToCreate.push({
                        serviceDate: date,
                        serviceType: 'weekday',
                        weekNumber: parseInt(wk.weekNumber, 10),
                        male: 0,
                        female: 0,
                        child: 0,
                        total,
                        specialProgram: wk.specialProgram || '',
                        comments: wk.comments || '',
                        testimony: wk.testimony || '',
                        installationId: activeInstallationId
                    });
                }
            });
        }

        if (Array.isArray(specials)) {
            specials.forEach(sp => {
                if (sp.specialProgram) {
                    const total = parseInt(sp.total, 10) || 0;
                    recordsToCreate.push({
                        serviceDate: `${year}-${paddedMonth}-01`,
                        serviceType: 'special',
                        weekNumber: 0,
                        male: 0,
                        female: 0,
                        child: 0,
                        total,
                        specialProgram: sp.specialProgram,
                        comments: sp.comments || '',
                        testimony: sp.testimony || '',
                        installationId: activeInstallationId
                    });
                }
            });
        }

        if (recordsToCreate.length > 0) {
            await Attendance.bulkCreate(recordsToCreate);
        }

        res.json({ success: true, message: 'Attendance recorded successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to record attendance: ' + err.message });
    }
});

app.post('/finance/save', isAuthenticated, async (req, res) => {
    try {
        const { month: monthStr, sundays, weekdays, specials, expenditures } = req.body;
        if (!monthStr) {
            return res.status(400).json({ success: false, message: 'Month is required' });
        }

        const parts = monthStr.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const paddedMonth = month.toString().padStart(2, '0');
        const periodStr = `${year}-${paddedMonth}`;
        const activeInstallationId = req.activeInstallationId;

        await Finance.destroy({
            where: {
                installationId: activeInstallationId,
                period: periodStr
            }
        });

        const recordsToCreate = [];

        if (Array.isArray(sundays)) {
            sundays.forEach(sun => {
                const tithes = parseFloat(sun.tithes) || 0;
                const offering = parseFloat(sun.offering) || 0;
                const specialCollection = parseFloat(sun.specialCollection) || 0;
                recordsToCreate.push({
                    period: periodStr,
                    weekNumber: parseInt(sun.weekNumber, 10),
                    serviceType: 'sunday',
                    tithes,
                    offering,
                    specialCollection,
                    totalIncome: tithes + offering + specialCollection,
                    totalExpenditure: 0,
                    installationId: activeInstallationId
                });
            });
        }

        if (Array.isArray(weekdays)) {
            weekdays.forEach(wk => {
                const tithes = parseFloat(wk.tithes) || 0;
                const offering = parseFloat(wk.offering) || 0;
                const specialCollection = parseFloat(wk.specialCollection) || 0;
                recordsToCreate.push({
                    period: periodStr,
                    weekNumber: parseInt(wk.weekNumber, 10),
                    serviceType: 'weekday',
                    tithes,
                    offering,
                    specialCollection,
                    totalIncome: tithes + offering + specialCollection,
                    totalExpenditure: 0,
                    installationId: activeInstallationId
                });
            });
        }

        if (Array.isArray(specials)) {
            specials.forEach(sp => {
                const tithes = parseFloat(sp.tithes) || 0;
                const offering = parseFloat(sp.offering) || 0;
                const specialCollection = parseFloat(sp.specialCollection) || 0;
                recordsToCreate.push({
                    period: periodStr,
                    weekNumber: parseInt(sp.weekNumber, 10),
                    serviceType: 'special',
                    tithes,
                    offering,
                    specialCollection,
                    totalIncome: tithes + offering + specialCollection,
                    totalExpenditure: 0,
                    installationId: activeInstallationId
                });
            });
        }

        if (expenditures) {
            const expElectricity = parseFloat(expenditures.expElectricity) || 0;
            const expStationery = parseFloat(expenditures.expStationery) || 0;
            const expPastor = parseFloat(expenditures.expPastor) || 0;
            const expWelfare = parseFloat(expenditures.expWelfare) || 0;
            const expMisc = parseFloat(expenditures.expMisc) || 0;
            const totalExpenditure = expElectricity + expStationery + expPastor + expWelfare + expMisc;

            recordsToCreate.push({
                period: periodStr,
                weekNumber: 0,
                serviceType: 'sunday',
                tithes: 0,
                offering: 0,
                specialCollection: 0,
                totalIncome: 0,
                totalExpenditure,
                expElectricity,
                expStationery,
                expPastor,
                expWelfare,
                expMisc,
                installationId: activeInstallationId
            });
        }

        if (recordsToCreate.length > 0) {
            await Finance.bulkCreate(recordsToCreate);
        }

        res.json({ success: true, message: 'Finance data recorded successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to record finance data: ' + err.message });
    }
});


// ─── Finance Ledger & Budget Management ─────────────────────────────────────
app.get('/finance/ledger', isAuthenticated, async (req, res) => {
    try {
        const period = req.query.period || new Date().toISOString().substring(0, 7);
        const transactions = await Transaction.findAll({
            where: { installationId: req.activeInstallationId },
            order: [['date', 'DESC']]
        });
        const budgets = await Budget.findAll({
            where: { installationId: req.activeInstallationId, period },
            order: [['category', 'ASC']]
        });

        // Compute spend vs budget per category
        const spendMap = {};
        transactions.filter(t => t.period === period || t.date.toString().startsWith(period)).forEach(t => {
            if (t.type === 'expense') {
                spendMap[t.category] = (spendMap[t.category] || 0) + parseFloat(t.amount);
            }
        });

        const budgetReport = budgets.map(b => {
            const spent = spendMap[b.category] || 0;
            return {
                ...b.get({ plain: true }),
                spent,
                remaining: parseFloat(b.amount) - spent,
                overspent: spent > parseFloat(b.amount)
            };
        });

        // Totals
        const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + parseFloat(t.amount), 0);
        const totalExpense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + parseFloat(t.amount), 0);

        res.render('finance-ledger', {
            title: 'Financial Ledger & Budget',
            transactions: transactions.map(t => t.get({ plain: true })),
            budgetReport,
            period,
            totalIncome,
            totalExpense,
            balance: totalIncome - totalExpense,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.render('error', { message: 'Failed to load ledger' });
    }
});

app.post('/finance/ledger/transaction', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'finance_officer']), async (req, res) => {
    const { type, category, amount, date, description } = req.body;
    try {
        await Transaction.create({
            type,
            category,
            amount: parseFloat(amount),
            date,
            description,
            installationId: req.activeInstallationId
        });
        await AuditLog.create({
            action: 'TRANSACTION_CREATED',
            details: `${type.toUpperCase()} of ${amount} in ${category} on ${date}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });
        res.redirect('/finance/ledger?success=Transaction recorded successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/finance/ledger?error=Failed to save transaction');
    }
});

app.post('/finance/ledger/budget', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'finance_officer']), async (req, res) => {
    const { category, amount, period } = req.body;
    try {
        const [budget, created] = await Budget.findOrCreate({
            where: { category, period, installationId: req.activeInstallationId },
            defaults: { amount: parseFloat(amount) }
        });
        if (!created) await budget.update({ amount: parseFloat(amount) });
        res.redirect(`/finance/ledger?period=${period}&success=Budget target saved`);
    } catch (err) {
        console.error(err);
        res.redirect('/finance/ledger?error=Failed to save budget');
    }
});

// ─── Weekly Report State Machine ─────────────────────────────────────────────
app.get('/reports', isAuthenticated, async (req, res) => {
    try {
        const reports = await WeeklyReport.findAll({
            where: { installationId: req.activeInstallationId },
            include: [
                { model: User, as: 'SubmittedBy', attributes: ['fullName'] },
                { model: User, as: 'ApprovedBy', attributes: ['fullName'] }
            ],
            order: [['period', 'DESC'], ['weekNumber', 'DESC']]
        });
        const role = req.session.user.role;
        const canApprove = ['pastor', 'superadmin', 'admin'].includes(role);
        const canSubmit = ['secretary', 'admin', 'pastor', 'superadmin'].includes(role);

        res.render('reports', {
            title: 'Weekly Reports',
            reports: reports.map(r => r.get({ plain: true })),
            canApprove,
            canSubmit,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.render('error', { message: 'Failed to load reports' });
    }
});

app.post('/reports/create', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    const { period, weekNumber, notes } = req.body;
    const now = new Date();
    // Late = if we are past Sunday of that week (simplified: if day > weekNum * 7)
    const isLate = now.getDate() > parseInt(weekNumber) * 7;
    try {
        await WeeklyReport.create({
            period, weekNumber: parseInt(weekNumber), notes,
            status: 'draft', isLate,
            submittedById: req.session.user.id,
            installationId: req.activeInstallationId
        });
        res.redirect('/reports?success=Report draft created');
    } catch (err) {
        console.error(err);
        res.redirect('/reports?error=Failed to create report');
    }
});

app.post('/reports/:id/submit', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    try {
        const report = await WeeklyReport.findOne({ where: { id: req.params.id, installationId: req.activeInstallationId } });
        if (!report) return res.redirect('/reports?error=Report not found');
        if (report.status !== 'draft') return res.redirect('/reports?error=Only draft reports can be submitted');
        await report.update({ status: 'submitted' });
        // Snapshot
        await ReportSnapshot.create({ version: report.version, snapshotData: report.get({ plain: true }), changedById: req.session.user.id, reportId: report.id });
        res.redirect('/reports?success=Report submitted for approval');
    } catch (err) {
        console.error(err);
        res.redirect('/reports?error=Failed to submit report');
    }
});

app.post('/reports/:id/approve', isAuthenticated, authorize(['superadmin', 'admin', 'pastor']), async (req, res) => {
    try {
        const report = await WeeklyReport.findOne({ where: { id: req.params.id, installationId: req.activeInstallationId } });
        if (!report) return res.redirect('/reports?error=Report not found');
        if (report.status !== 'submitted') return res.redirect('/reports?error=Only submitted reports can be approved');
        await report.update({ status: 'approved', pastorId: req.session.user.id });
        res.redirect('/reports?success=Report approved successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/reports?error=Failed to approve report');
    }
});

app.post('/reports/:id/reject', isAuthenticated, authorize(['superadmin', 'admin', 'pastor']), async (req, res) => {
    const { rejectionReason } = req.body;
    try {
        const report = await WeeklyReport.findOne({ where: { id: req.params.id, installationId: req.activeInstallationId } });
        if (!report) return res.redirect('/reports?error=Report not found');
        await report.update({ status: 'rejected', rejectionReason: rejectionReason || 'No reason given' });
        res.redirect('/reports?success=Report rejected with feedback');
    } catch (err) {
        console.error(err);
        res.redirect('/reports?error=Failed to reject report');
    }
});

// ─── Events Management ────────────────────────────────────────────────────────
app.get('/events', isAuthenticated, async (req, res) => {
    try {
        const events = await Event.findAll({
            where: { installationId: req.activeInstallationId },
            include: [{ model: EventRegistration }],
            order: [['eventDate', 'DESC']]
        });
        res.render('events', {
            title: 'Events & Calendar',
            events: events.map(e => {
                const d = e.get({ plain: true });
                d.registrationCount = d.EventRegistrations ? d.EventRegistrations.length : 0;
                return d;
            }),
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.render('error', { message: 'Failed to load events' });
    }
});

app.post('/events/create', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    const { title, description, eventDate, location, livestreamLink } = req.body;
    try {
        await Event.create({ title, description, eventDate, location, livestreamLink, installationId: req.activeInstallationId });
        res.redirect('/events?success=Event created successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/events?error=Failed to create event');
    }
});

app.post('/events/:id/delete', isAuthenticated, authorize(['superadmin', 'admin', 'pastor']), async (req, res) => {
    try {
        await Event.destroy({ where: { id: req.params.id, installationId: req.activeInstallationId } });
        res.redirect('/events?success=Event deleted');
    } catch (err) {
        res.redirect('/events?error=Failed to delete event');
    }
});

// ─── Media Catalog ────────────────────────────────────────────────────────────
app.get('/media', isAuthenticated, async (req, res) => {
    try {
        const media = await MediaItem.findAll({
            where: { installationId: req.activeInstallationId },
            order: [['createdAt', 'DESC']]
        });
        res.render('media', {
            title: 'Media Library',
            media: media.map(m => m.get({ plain: true })),
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.render('error', { message: 'Failed to load media library' });
    }
});

app.post('/media/create', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    const { title, description, category, fileUrl, livestreamUrl, permissions } = req.body;
    try {
        await MediaItem.create({ title, description, category, fileUrl, livestreamUrl, permissions, installationId: req.activeInstallationId });
        res.redirect('/media?success=Media item added to catalog');
    } catch (err) {
        console.error(err);
        res.redirect('/media?error=Failed to add media item');
    }
});

// ─── Audit Log ────────────────────────────────────────────────────────────────
app.get('/audit', isAuthenticated, authorize(['superadmin', 'global_auditor', 'pastor']), async (req, res) => {
    try {
        const logs = await AuditLog.findAll({
            where: { installationId: req.activeInstallationId },
            include: [{ model: User, attributes: ['fullName', 'email'] }],
            order: [['createdAt', 'DESC']],
            limit: 200
        });
        res.render('audit', {
            title: 'Audit & Activity Log',
            logs: logs.map(l => l.get({ plain: true }))
        });
    } catch (err) {
        console.error(err);
        res.render('error', { message: 'Failed to load audit log' });
    }
});

app.use('/departments', departmentRoutes);


// Database Sync & Server Start
const PORT = process.env.PORT || 3000;

sequelize.sync({ alter: true }).then(() => {
    console.log('Database synced successfully.');
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Unable to sync database:', err);
});
