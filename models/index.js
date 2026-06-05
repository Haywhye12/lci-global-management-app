const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Installation = sequelize.define('Installation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    location: {
        type: DataTypes.STRING
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active'
    },
    subdomain: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: true
    },
    timezone: {
        type: DataTypes.STRING,
        defaultValue: 'Africa/Lagos'
    },
    currency: {
        type: DataTypes.STRING,
        defaultValue: 'NGN'
    },
    contactEmail: {
        type: DataTypes.STRING
    },
    contactPhone: {
        type: DataTypes.STRING
    },
    logoUrl: {
        type: DataTypes.STRING,
        defaultValue: '/images/logo.jpg'
    },
    country: {
        type: DataTypes.STRING,
        defaultValue: 'Nigeria'
    },
    region: {
        type: DataTypes.STRING,
        defaultValue: 'Lagos State'
    }
});

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    fullName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    role: {
        type: DataTypes.ENUM('superadmin', 'global_auditor', 'tech_support', 'admin', 'pastor', 'secretary', 'finance_officer', 'hod', 'worker', 'member', 'minister'),
        defaultValue: 'worker'
    },
    profilePicture: {
        type: DataTypes.STRING,
        defaultValue: '/uploads/default-avatar.png'
    },
    installationId: {
        type: DataTypes.UUID,
        references: {
            model: Installation,
            key: 'id'
        }
    },
    // 2FA Fields
    twoFactorSecret: {
        type: DataTypes.STRING,
        allowNull: true
    },
    twoFactorEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // Lockout Protection Fields
    failedLoginAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    lockoutUntil: {
        type: DataTypes.DATE,
        allowNull: true
    },
    // Password Reset Fields
    passwordResetToken: {
        type: DataTypes.STRING,
        allowNull: true
    },
    passwordResetExpires: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

Installation.hasMany(User, { foreignKey: 'installationId' });
User.belongsTo(Installation, { foreignKey: 'installationId' });

const Member = sequelize.define('Member', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    fullName: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING },
    phoneNumber: { type: DataTypes.STRING },
    gender: { type: DataTypes.ENUM('male', 'female') },
    address: { type: DataTypes.TEXT },
    status: { type: DataTypes.ENUM('active', 'inactive', 'transferred', 'deceased'), defaultValue: 'active' },
    classification: { type: DataTypes.ENUM('visitor', 'new_convert', 'baptized', 'worker'), defaultValue: 'visitor' },
    familyId: { type: DataTypes.UUID, allowNull: true },
    familyRole: { type: DataTypes.STRING, allowNull: true },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(Member, { foreignKey: 'installationId' });
Member.belongsTo(Installation, { foreignKey: 'installationId' });

// Inter-Branch Member Transfers
const MemberTransfer = sequelize.define('MemberTransfer', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    status: { type: DataTypes.ENUM('pending', 'approved_source', 'rejected_source', 'completed', 'rejected_destination'), defaultValue: 'pending' },
    notes: { type: DataTypes.TEXT },
    sourceInstallationId: { type: DataTypes.UUID, allowNull: false },
    destinationInstallationId: { type: DataTypes.UUID, allowNull: false },
    memberId: { type: DataTypes.UUID, allowNull: false },
    requestedById: { type: DataTypes.UUID, allowNull: false }
});

Member.hasMany(MemberTransfer, { foreignKey: 'memberId' });
MemberTransfer.belongsTo(Member, { foreignKey: 'memberId' });
MemberTransfer.belongsTo(Installation, { as: 'SourceBranch', foreignKey: 'sourceInstallationId' });
MemberTransfer.belongsTo(Installation, { as: 'DestinationBranch', foreignKey: 'destinationInstallationId' });
MemberTransfer.belongsTo(User, { as: 'RequestedBy', foreignKey: 'requestedById' });

// Attendance (Legacy Aggregate Model)
const Attendance = sequelize.define('Attendance', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    serviceDate: { type: DataTypes.DATEONLY, allowNull: false },
    serviceType: { type: DataTypes.ENUM('sunday', 'weekday', 'special'), allowNull: false },
    weekNumber: { type: DataTypes.INTEGER },
    male: { type: DataTypes.INTEGER, defaultValue: 0 },
    female: { type: DataTypes.INTEGER, defaultValue: 0 },
    child: { type: DataTypes.INTEGER, defaultValue: 0 },
    total: { type: DataTypes.INTEGER, defaultValue: 0 },
    manualHeadcount: { type: DataTypes.INTEGER, defaultValue: 0 }, // For checking discrepancies
    comments: { type: DataTypes.TEXT },
    testimony: { type: DataTypes.TEXT },
    specialProgram: { type: DataTypes.TEXT },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(Attendance, { foreignKey: 'installationId' });
Attendance.belongsTo(Installation, { foreignKey: 'installationId' });

// Individual Member Attendance (Dual Check-in Mode)
const MemberAttendance = sequelize.define('MemberAttendance', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    serviceType: { type: DataTypes.ENUM('sunday', 'midweek', 'youth', 'children', 'online'), defaultValue: 'sunday' },
    serviceDate: { type: DataTypes.DATEONLY, allowNull: false },
    checkInTime: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    checkInMethod: { type: DataTypes.ENUM('manual', 'qr'), defaultValue: 'manual' },
    memberId: { type: DataTypes.UUID, allowNull: false },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Member.hasMany(MemberAttendance, { foreignKey: 'memberId', onDelete: 'CASCADE' });
MemberAttendance.belongsTo(Member, { foreignKey: 'memberId' });
Installation.hasMany(MemberAttendance, { foreignKey: 'installationId' });
MemberAttendance.belongsTo(Installation, { foreignKey: 'installationId' });

// Financial Ledger (Categorized Transactions)
const Transaction = sequelize.define('Transaction', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    type: { type: DataTypes.ENUM('income', 'expense'), allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false }, // Tithes, Offerings, Salaries, Utilities, Welfare
    amount: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    description: { type: DataTypes.TEXT },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(Transaction, { foreignKey: 'installationId' });
Transaction.belongsTo(Installation, { foreignKey: 'installationId' });

// Budget targets per category
const Budget = sequelize.define('Budget', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    category: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    period: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(Budget, { foreignKey: 'installationId' });
Budget.belongsTo(Installation, { foreignKey: 'installationId' });

// Finance (Legacy aggregate table - keep for compatibility)
const Finance = sequelize.define('Finance', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    period: { type: DataTypes.STRING, allowNull: false }, // e.g. "2026-05"
    weekNumber: { type: DataTypes.INTEGER },
    serviceType: { type: DataTypes.ENUM('sunday', 'weekday', 'special'), defaultValue: 'sunday' },
    tithes: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    offering: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    specialCollection: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    totalIncome: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    totalExpenditure: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    expElectricity: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    expStationery: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    expPastor: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    expWelfare: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    expMisc: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(Finance, { foreignKey: 'installationId' });
Finance.belongsTo(Installation, { foreignKey: 'installationId' });

// Reporting & Approval Workflow State Machine
const WeeklyReport = sequelize.define('WeeklyReport', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    period: { type: DataTypes.STRING, allowNull: false }, // YYYY-MM
    weekNumber: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('draft', 'submitted', 'approved', 'rejected', 'hq_reviewed'), defaultValue: 'draft' },
    notes: { type: DataTypes.TEXT },
    rejectionReason: { type: DataTypes.TEXT },
    isLate: { type: DataTypes.BOOLEAN, defaultValue: false },
    version: { type: DataTypes.INTEGER, defaultValue: 1 },
    submittedById: { type: DataTypes.UUID, allowNull: true },
    pastorId: { type: DataTypes.UUID, allowNull: true },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(WeeklyReport, { foreignKey: 'installationId' });
WeeklyReport.belongsTo(Installation, { foreignKey: 'installationId' });
WeeklyReport.belongsTo(User, { as: 'SubmittedBy', foreignKey: 'submittedById' });
WeeklyReport.belongsTo(User, { as: 'ApprovedBy', foreignKey: 'pastorId' });

const ReportSnapshot = sequelize.define('ReportSnapshot', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    version: { type: DataTypes.INTEGER, defaultValue: 1 },
    snapshotData: { type: DataTypes.JSON, allowNull: false },
    changedById: { type: DataTypes.UUID, allowNull: false },
    reportId: { type: DataTypes.UUID, allowNull: false }
});

WeeklyReport.hasMany(ReportSnapshot, { foreignKey: 'reportId', onDelete: 'CASCADE' });
ReportSnapshot.belongsTo(WeeklyReport, { foreignKey: 'reportId' });
ReportSnapshot.belongsTo(User, { as: 'ChangedBy', foreignKey: 'changedById' });

// Member Care & Follow-Up
const FirstTimer = sequelize.define('FirstTimer', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    fullName: { type: DataTypes.STRING, allowNull: false },
    phoneNumber: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    gender: { type: DataTypes.ENUM('male', 'female') },
    address: { type: DataTypes.TEXT },
    invitedBy: { type: DataTypes.STRING },
    serviceAttended: { type: DataTypes.STRING },
    prayerRequest: { type: DataTypes.TEXT },
    visitDate: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'contacted', 'converted'), defaultValue: 'pending' },
    occupation: { type: DataTypes.STRING },
    maritalStatus: { type: DataTypes.STRING },
    howHeard: { type: DataTypes.STRING },
    socialMedia: { type: DataTypes.STRING },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

const FollowUp = sequelize.define('FollowUp', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    notes: { type: DataTypes.TEXT },
    actionDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    nextStep: { type: DataTypes.STRING },
    reminderDate: { type: DataTypes.DATEONLY, allowNull: true }, // Added for automatic follow-up reminders
    userId: { type: DataTypes.UUID }, // The person doing the follow-up
    firstTimerId: { type: DataTypes.UUID, allowNull: true },
    memberId: { type: DataTypes.UUID, allowNull: true } // Can follow up general members too
});

Installation.hasMany(FirstTimer, { foreignKey: 'installationId' });
FirstTimer.belongsTo(Installation, { foreignKey: 'installationId' });
FirstTimer.hasMany(FollowUp, { foreignKey: 'firstTimerId' });
FollowUp.belongsTo(FirstTimer, { foreignKey: 'firstTimerId' });

Member.hasMany(FollowUp, { foreignKey: 'memberId' });
FollowUp.belongsTo(Member, { foreignKey: 'memberId' });

User.hasMany(FollowUp, { foreignKey: 'userId' });
FollowUp.belongsTo(User, { foreignKey: 'userId' });

// Departments
const Department = sequelize.define('Department', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    installationId: { type: DataTypes.UUID, allowNull: false },
    headId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: User,
            key: 'id'
        }
    }
});

const DepartmentMembership = sequelize.define('DepartmentMembership', {
    role: { type: DataTypes.STRING }, // e.g. "Head", "Member", "Assistant"
    userId: { type: DataTypes.UUID },
    departmentId: { type: DataTypes.UUID }
});

Installation.hasMany(Department, { foreignKey: 'installationId' });
Department.belongsTo(Installation, { foreignKey: 'installationId' });
User.belongsToMany(Department, { through: DepartmentMembership, foreignKey: 'userId' });
Department.belongsToMany(User, { through: DepartmentMembership, foreignKey: 'departmentId' });

const DepartmentReport = sequelize.define('DepartmentReport', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING, allowNull: false },
    attendanceCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    comments: { type: DataTypes.TEXT },
    testimony: { type: DataTypes.TEXT },
    specialProgram: { type: DataTypes.TEXT },
    reportDate: { type: DataTypes.DATEONLY, allowNull: false },
    departmentId: { type: DataTypes.UUID, allowNull: false },
    submittedById: { type: DataTypes.UUID, allowNull: false }
});

Department.belongsTo(User, { as: 'Head', foreignKey: 'headId' });
User.hasMany(Department, { as: 'HeadedDepartments', foreignKey: 'headId' });
Department.hasMany(DepartmentReport, { foreignKey: 'departmentId', onDelete: 'CASCADE' });
DepartmentReport.belongsTo(Department, { foreignKey: 'departmentId' });
User.hasMany(DepartmentReport, { foreignKey: 'submittedById' });
DepartmentReport.belongsTo(User, { as: 'SubmittedBy', foreignKey: 'submittedById' });

// Training Profiles
const TrainingLog = sequelize.define('TrainingLog', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    courseName: { type: DataTypes.STRING, allowNull: false },
    completedAt: { type: DataTypes.DATEONLY, allowNull: false },
    notes: { type: DataTypes.TEXT },
    userId: { type: DataTypes.UUID, allowNull: false }
});

User.hasMany(TrainingLog, { foreignKey: 'userId', onDelete: 'CASCADE' });
TrainingLog.belongsTo(User, { foreignKey: 'userId' });

// Duty Assignments / Roster
const DutyRoster = sequelize.define('DutyRoster', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    role: { type: DataTypes.STRING, allowNull: false },
    serviceDate: { type: DataTypes.DATEONLY, allowNull: false },
    serviceType: { type: DataTypes.STRING, defaultValue: 'Sunday Service' },
    status: { type: DataTypes.ENUM('assigned', 'confirmed', 'declined'), defaultValue: 'assigned' },
    userId: { type: DataTypes.UUID, allowNull: false },
    departmentId: { type: DataTypes.UUID, allowNull: true },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

User.hasMany(DutyRoster, { foreignKey: 'userId', onDelete: 'CASCADE' });
DutyRoster.belongsTo(User, { foreignKey: 'userId' });
Department.hasMany(DutyRoster, { foreignKey: 'departmentId' });
DutyRoster.belongsTo(Department, { foreignKey: 'departmentId' });
Installation.hasMany(DutyRoster, { foreignKey: 'installationId' });
DutyRoster.belongsTo(Installation, { foreignKey: 'installationId' });

// Events & Volunteers
const Event = sequelize.define('Event', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    eventDate: { type: DataTypes.DATE, allowNull: false },
    location: { type: DataTypes.STRING },
    livestreamLink: { type: DataTypes.STRING },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

const EventRegistration = sequelize.define('EventRegistration', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    registeredAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    memberId: { type: DataTypes.UUID, allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: true },
    eventId: { type: DataTypes.UUID, allowNull: false }
});

const EventVolunteer = sequelize.define('EventVolunteer', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    role: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM('applied', 'approved', 'declined'), defaultValue: 'applied' },
    memberId: { type: DataTypes.UUID, allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: true },
    eventId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(Event, { foreignKey: 'installationId' });
Event.belongsTo(Installation, { foreignKey: 'installationId' });

Event.hasMany(EventRegistration, { foreignKey: 'eventId', onDelete: 'CASCADE' });
EventRegistration.belongsTo(Event, { foreignKey: 'eventId' });
EventRegistration.belongsTo(Member, { foreignKey: 'memberId' });
EventRegistration.belongsTo(User, { foreignKey: 'userId' });

Event.hasMany(EventVolunteer, { foreignKey: 'eventId', onDelete: 'CASCADE' });
EventVolunteer.belongsTo(Event, { foreignKey: 'eventId' });
EventVolunteer.belongsTo(Member, { foreignKey: 'memberId' });
EventVolunteer.belongsTo(User, { foreignKey: 'userId' });

// Media Catalog
const MediaItem = sequelize.define('MediaItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    category: { type: DataTypes.ENUM('audio', 'video', 'podcast', 'photo', 'livestream'), defaultValue: 'audio' },
    fileUrl: { type: DataTypes.STRING },
    livestreamUrl: { type: DataTypes.STRING },
    permissions: { type: DataTypes.ENUM('public', 'private', 'downloadable'), defaultValue: 'public' },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(MediaItem, { foreignKey: 'installationId' });
MediaItem.belongsTo(Installation, { foreignKey: 'installationId' });

// Multi-Channel Notifications log
const NotificationLog = sequelize.define('NotificationLog', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    recipientEmail: { type: DataTypes.STRING },
    recipientPhone: { type: DataTypes.STRING },
    channel: { type: DataTypes.ENUM('email', 'sms', 'push', 'whatsapp', 'in_app'), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'sent', 'failed'), defaultValue: 'pending' },
    triggerEvent: { type: DataTypes.STRING },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

Installation.hasMany(NotificationLog, { foreignKey: 'installationId' });
NotificationLog.belongsTo(Installation, { foreignKey: 'installationId' });

// Audit & Compliance Ledger
const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    action: { type: DataTypes.STRING, allowNull: false },
    details: { type: DataTypes.TEXT },
    ipAddress: { type: DataTypes.STRING },
    userId: { type: DataTypes.UUID, allowNull: true },
    installationId: { type: DataTypes.UUID, allowNull: true }
});

User.hasMany(AuditLog, { foreignKey: 'userId', onDelete: 'SET NULL' });
AuditLog.belongsTo(User, { foreignKey: 'userId' });
Installation.hasMany(AuditLog, { foreignKey: 'installationId', onDelete: 'SET NULL' });
AuditLog.belongsTo(Installation, { foreignKey: 'installationId' });

// E-Books Library Model
const Book = sequelize.define('Book', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING, allowNull: false },
    author: { type: DataTypes.STRING, defaultValue: 'LCI Global' },
    description: { type: DataTypes.TEXT },
    pdfUrl: { type: DataTypes.STRING, allowNull: false },
    coverUrl: { type: DataTypes.STRING, defaultValue: '/images/book-cover.jpg' },
    uploadedBy: { type: DataTypes.UUID, allowNull: true },
    installationId: { type: DataTypes.UUID, allowNull: true } // Null means available globally, otherwise branch scoped
});

// Community Bulletin / Branch Feed Model
const BranchPost = sequelize.define('BranchPost', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING },
    content: { type: DataTypes.TEXT, allowNull: false },
    authorName: { type: DataTypes.STRING },
    userId: { type: DataTypes.UUID, allowNull: true },
    installationId: { type: DataTypes.UUID, allowNull: false } // Branch specific bulletin feed
});

// Dashboard News Feed Model (With optional picture, no videos)
const DashboardPost = sequelize.define('DashboardPost', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    content: { type: DataTypes.TEXT, allowNull: false },
    imageUrl: { type: DataTypes.STRING },
    authorName: { type: DataTypes.STRING },
    userId: { type: DataTypes.UUID, allowNull: true },
    installationId: { type: DataTypes.UUID, allowNull: false }
});

// Relationships
Installation.hasMany(Book, { foreignKey: 'installationId' });
Book.belongsTo(Installation, { foreignKey: 'installationId' });

Installation.hasMany(BranchPost, { foreignKey: 'installationId' });
BranchPost.belongsTo(Installation, { foreignKey: 'installationId' });

Installation.hasMany(DashboardPost, { foreignKey: 'installationId' });
DashboardPost.belongsTo(Installation, { foreignKey: 'installationId' });

User.hasMany(BranchPost, { foreignKey: 'userId', onDelete: 'SET NULL' });
BranchPost.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(DashboardPost, { foreignKey: 'userId', onDelete: 'SET NULL' });
DashboardPost.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
    sequelize,
    Installation,
    User,
    Member,
    MemberTransfer,
    Attendance,
    MemberAttendance,
    Transaction,
    Budget,
    Finance,
    WeeklyReport,
    ReportSnapshot,
    FirstTimer,
    FollowUp,
    Department,
    DepartmentMembership,
    DepartmentReport,
    TrainingLog,
    DutyRoster,
    Event,
    EventRegistration,
    EventVolunteer,
    MediaItem,
    NotificationLog,
    AuditLog,
    Book,
    BranchPost,
    DashboardPost
};
