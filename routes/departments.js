const express = require('express');
const router = express.Router();
const { Department, User, DepartmentMembership, DepartmentReport } = require('../models');
const { isAuthenticated, authorize } = require('../middleware/auth');

// List all departments
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const departments = await Department.findAll({
            where: { installationId: req.activeInstallationId },
            include: [
                { model: User, as: 'Head', attributes: ['id', 'fullName', 'profilePicture'] },
                { model: User, attributes: ['id'] } // For members count
            ]
        });

        const deps = departments.map(d => {
            const data = d.get({ plain: true });
            data.memberCount = data.Users ? data.Users.length : 0;
            return data;
        });

        // Get all users in installation for the "assign HOD" dropdown
        const allUsers = await User.findAll({
            where: { installationId: req.activeInstallationId },
            attributes: ['id', 'fullName', 'role']
        });
        
        const users = allUsers.map(u => u.get({ plain: true }));

        res.render('departments', {
            title: 'Departments',
            departments: deps,
            users: users,
            error: req.query.error,
            success: req.query.success
        });
    } catch (err) {
        console.error(err);
        res.redirect('/?error=Failed to load departments');
    }
});

// Create a department (Admin/Pastor only)
router.post('/create', isAuthenticated, authorize(['superadmin', 'admin', 'pastor']), async (req, res) => {
    const { name, description, headId } = req.body;

    try {
        const newDept = await Department.create({
            name,
            description,
            installationId: req.activeInstallationId,
            headId: headId || null
        });

        // Automatically add head as a member if headId is provided
        if (headId) {
            await DepartmentMembership.create({
                role: 'Head',
                userId: headId,
                departmentId: newDept.id
            });
        }

        res.redirect('/departments?success=Department created successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/departments?error=Failed to create department');
    }
});

// Department details page
router.get('/:id', isAuthenticated, async (req, res) => {
    try {
        const department = await Department.findOne({
            where: { 
                id: req.params.id,
                installationId: req.activeInstallationId
            },
            include: [
                { model: User, as: 'Head', attributes: ['id', 'fullName', 'profilePicture', 'role', 'email'] },
                { 
                    model: User, 
                    attributes: ['id', 'fullName', 'profilePicture', 'role', 'email'],
                    through: { attributes: ['role'] }
                },
                {
                    model: DepartmentReport,
                    include: [{ model: User, as: 'SubmittedBy', attributes: ['fullName', 'profilePicture'] }],
                    order: [['reportDate', 'DESC']]
                }
            ]
        });

        if (!department) {
            return res.redirect('/departments?error=Department not found');
        }

        // Get all users not currently in the department for the "add member" dropdown
        const allUsers = await User.findAll({
            where: { installationId: req.activeInstallationId },
            attributes: ['id', 'fullName', 'profilePicture']
        });

        const currentMemberIds = department.Users.map(u => u.id);
        const availableUsers = allUsers
            .map(u => u.get({ plain: true }))
            .filter(u => !currentMemberIds.includes(u.id));

        const data = department.get({ plain: true });
        
        // Ensure profile pictures exist for members
        data.Users.forEach(u => {
            if (!u.profilePicture) {
                u.profilePicture = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.fullName)}&background=random&color=fff`;
            }
            if (u.id === data.headId) {
                u.isHead = true;
            }
        });

        // Determine permissions
        const isHOD = req.session.user.id === data.headId;
        const isAdmin = ['superadmin', 'admin', 'pastor'].includes(req.session.user.role);

        res.render('department-details', {
            title: `Department: ${data.name}`,
            department: data,
            availableUsers,
            allUsers: allUsers.map(u => u.get({plain:true})), // For assigning new head
            isHOD,
            isAdmin,
            error: req.query.error,
            success: req.query.success
        });

    } catch (err) {
        console.error(err);
        res.redirect('/departments?error=Failed to load department details');
    }
});

// Assign new Head of Department (Admin/Pastor only)
router.post('/:id/assign-head', isAuthenticated, authorize(['superadmin', 'admin', 'pastor']), async (req, res) => {
    try {
        const department = await Department.findOne({
            where: { id: req.params.id, installationId: req.activeInstallationId }
        });

        if (!department) return res.redirect('/departments?error=Department not found');

        const newHeadId = req.body.headId || null;

        await department.update({ headId: newHeadId });

        // If a new head is assigned, make sure they are a member
        if (newHeadId) {
            const membership = await DepartmentMembership.findOne({
                where: { userId: newHeadId, departmentId: department.id }
            });
            if (!membership) {
                await DepartmentMembership.create({
                    role: 'Head',
                    userId: newHeadId,
                    departmentId: department.id
                });
            } else {
                await membership.update({ role: 'Head' });
            }
        }

        res.redirect(`/departments/${department.id}?success=Head of Department assigned successfully`);
    } catch (err) {
        console.error(err);
        res.redirect(`/departments/${req.params.id}?error=Failed to assign Head of Department`);
    }
});

// Add member to department (Admin/Pastor only)
router.post('/:id/members/add', isAuthenticated, authorize(['superadmin', 'admin', 'pastor']), async (req, res) => {
    try {
        const department = await Department.findOne({
            where: { id: req.params.id, installationId: req.activeInstallationId }
        });

        if (!department) return res.redirect('/departments?error=Department not found');

        await DepartmentMembership.create({
            role: 'Member',
            userId: req.body.userId,
            departmentId: department.id
        });

        res.redirect(`/departments/${department.id}?success=Member added successfully`);
    } catch (err) {
        console.error(err);
        res.redirect(`/departments/${req.params.id}?error=Failed to add member`);
    }
});

// Remove member from department (Admin/Pastor only)
router.post('/:id/members/remove/:userId', isAuthenticated, authorize(['superadmin', 'admin', 'pastor']), async (req, res) => {
    try {
        const department = await Department.findOne({
            where: { id: req.params.id, installationId: req.activeInstallationId }
        });

        if (!department) return res.redirect('/departments?error=Department not found');

        // Check if removing the current Head
        if (department.headId === req.params.userId) {
            await department.update({ headId: null });
        }

        await DepartmentMembership.destroy({
            where: { userId: req.params.userId, departmentId: department.id }
        });

        res.redirect(`/departments/${department.id}?success=Member removed successfully`);
    } catch (err) {
        console.error(err);
        res.redirect(`/departments/${req.params.id}?error=Failed to remove member`);
    }
});

// Create department report (HOD only)
router.post('/:id/reports/create', isAuthenticated, async (req, res) => {
    try {
        const department = await Department.findOne({
            where: { id: req.params.id, installationId: req.activeInstallationId }
        });

        if (!department) return res.redirect('/departments?error=Department not found');

        // Verify the user is the Head
        if (department.headId !== req.session.user.id && !['superadmin', 'admin', 'pastor'].includes(req.session.user.role)) {
            return res.redirect(`/departments/${department.id}?error=Only the Head of Department or an Admin can submit reports`);
        }

        const { title, reportDate, attendanceCount, comments, testimony, specialProgram } = req.body;

        await DepartmentReport.create({
            title,
            attendanceCount: parseInt(attendanceCount) || 0,
            comments,
            testimony,
            specialProgram,
            reportDate,
            departmentId: department.id,
            submittedById: req.session.user.id
        });

        res.redirect(`/departments/${department.id}?success=Report submitted successfully`);
    } catch (err) {
        console.error(err);
        res.redirect(`/departments/${req.params.id}?error=Failed to submit report`);
    }
});

module.exports = router;
