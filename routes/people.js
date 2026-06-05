const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User, Member, Installation, MemberTransfer, AuditLog } = require('../models');
const { isAuthenticated, authorize } = require('../middleware/auth');

// List all people, members, families, and transfers in the installation
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const people = await User.findAll({
            where: { installationId: req.activeInstallationId },
            order: [['role', 'ASC'], ['fullName', 'ASC']]
        });
        
        const isSecretary = req.session.user.role === 'secretary';

        const peopleList = people.map(p => {
            const data = p.get({ plain: true });
            if (!data.profilePicture) {
                data.profilePicture = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.fullName)}&background=random&color=fff`;
            }
            
            data.canDelete = true;
            if (isSecretary && data.role === 'pastor') {
                data.canDelete = false;
            }
            return data;
        });

        // Fetch Members
        const members = await Member.findAll({
            where: { installationId: req.activeInstallationId },
            order: [['fullName', 'ASC']]
        });
        
        const memberList = members.map(m => {
            const data = m.get({ plain: true });
            data.profilePicture = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.fullName)}&background=random&color=f3f4f6&color=6b7280`;
            return data;
        });

        // Group members by Family ID
        const familiesMap = {};
        memberList.forEach(m => {
            if (m.familyId) {
                if (!familiesMap[m.familyId]) {
                    familiesMap[m.familyId] = [];
                }
                familiesMap[m.familyId].push(m);
            }
        });
        const families = Object.keys(familiesMap).map(fid => {
            return {
                id: fid,
                members: familiesMap[fid],
                name: familiesMap[fid][0].fullName.split(' ').pop() + ' Family' // Surname of first member
            };
        });

        // Fetch all other installations for transfer destination dropdown
        const installations = await Installation.findAll({
            order: [['name', 'ASC']]
        });

        // Fetch inward and outward transfers
        const transfers = await MemberTransfer.findAll({
            include: [
                { model: Member },
                { model: Installation, as: 'SourceBranch' },
                { model: Installation, as: 'DestinationBranch' },
                { model: User, as: 'RequestedBy', attributes: ['fullName'] }
            ],
            order: [['createdAt', 'DESC']]
        });

        const activeTransfers = transfers.map(t => {
            const plain = t.get({ plain: true });
            plain.isOutward = plain.sourceInstallationId === req.activeInstallationId;
            plain.isInward = plain.destinationInstallationId === req.activeInstallationId;
            // Can current user approve?
            plain.canApprove = ['pastor', 'admin', 'superadmin'].includes(req.session.user.role);
            return plain;
        }).filter(t => t.isOutward || t.isInward);

        res.render('people', { 
            title: 'Members & Staff', 
            people: peopleList, 
            members: memberList,
            families,
            installations: installations.map(i => i.get({ plain: true })),
            transfers: activeTransfers,
            error: req.query.error,
            success: req.query.success
        });
    } catch (err) {
        console.error(err);
        res.redirect('/?error=Failed to load people list');
    }
});

// Create new person (Staff/Minister/Worker)
router.post('/create', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    const { fullName, email, password, role } = req.body;
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({
            fullName,
            email,
            password: hashedPassword,
            role,
            installationId: req.activeInstallationId
        });

        await AuditLog.create({
            action: 'USER_CREATED',
            details: `Created new staff account: ${fullName} (${role})`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/people?success=Person added successfully');
    } catch (err) {
        console.error(err);
        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.redirect('/people?error=Email already exists');
        }
        res.redirect('/people?error=Failed to add person');
    }
});

// Create new Church Member
router.post('/create-member', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    const { fullName, email, phoneNumber, gender, address, status, classification, familyId, familyRole } = req.body;
    
    try {
        await Member.create({
            fullName,
            email: email || null,
            phoneNumber: phoneNumber || null,
            gender: gender || null,
            address: address || null,
            status: status || 'active',
            classification: classification || 'visitor',
            familyId: familyId || null,
            familyRole: familyRole || null,
            installationId: req.activeInstallationId
        });

        await AuditLog.create({
            action: 'MEMBER_CREATED',
            details: `Registered member: ${fullName}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/people?success=Member added successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/people?error=Failed to add member');
    }
});

// Initiate Inter-Branch Transfer
router.post('/transfer/request', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    const { memberId, destinationInstallationId, notes } = req.body;

    try {
        const member = await Member.findByPk(memberId);
        if (!member) {
            return res.redirect('/people?error=Member not found');
        }

        // Cannot transfer to same branch
        if (member.installationId === destinationInstallationId) {
            return res.redirect('/people?error=Destination branch must be different from current branch');
        }

        await MemberTransfer.create({
            status: 'pending',
            notes: notes || '',
            sourceInstallationId: member.installationId,
            destinationInstallationId,
            memberId,
            requestedById: req.session.user.id
        });

        await AuditLog.create({
            action: 'TRANSFER_REQUESTED',
            details: `Requested transfer for member: ${member.fullName}`,
            userId: req.session.user.id,
            installationId: req.activeInstallationId
        });

        res.redirect('/people?success=Transfer request submitted successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/people?error=Failed to request transfer');
    }
});

// Approve / Decline Member Transfer
router.post('/transfer/:id/:action', isAuthenticated, authorize(['superadmin', 'admin', 'pastor']), async (req, res) => {
    const { id, action } = req.params; // action = approve OR reject

    try {
        const transfer = await MemberTransfer.findByPk(id, { include: [Member] });
        if (!transfer) {
            return res.redirect('/people?error=Transfer request not found');
        }

        const isSourcePastor = transfer.sourceInstallationId === req.activeInstallationId;
        const isDestPastor = transfer.destinationInstallationId === req.activeInstallationId;

        if (!isSourcePastor && !isDestPastor) {
            return res.redirect('/people?error=Unauthorized to act on this transfer');
        }

        if (action === 'reject') {
            await transfer.update({
                status: isSourcePastor ? 'rejected_source' : 'rejected_destination'
            });
            await AuditLog.create({
                action: 'TRANSFER_REJECTED',
                details: `Rejected transfer for member: ${transfer.Member.fullName}`,
                userId: req.session.user.id,
                installationId: req.activeInstallationId
            });
            return res.redirect('/people?success=Transfer request rejected');
        }

        if (action === 'approve') {
            if (isSourcePastor) {
                // If approved by source, move to approved_source
                await transfer.update({ status: 'approved_source' });
            } else if (isDestPastor) {
                // Approved by destination pastor
                if (transfer.status === 'approved_source') {
                    // Complete the transfer and move member
                    await transfer.update({ status: 'completed' });
                    await transfer.Member.update({
                        installationId: transfer.destinationInstallationId
                    });

                    await AuditLog.create({
                        action: 'TRANSFER_COMPLETED',
                        details: `Completed transfer for member: ${transfer.Member.fullName} to branch: ${transfer.destinationInstallationId}`,
                        userId: req.session.user.id,
                        installationId: req.activeInstallationId
                    });
                } else {
                    // If source hasn't approved yet, we can't complete, but we track approval
                    return res.redirect('/people?error=Source branch must approve the transfer first');
                }
            }
            res.redirect('/people?success=Transfer approved successfully');
        }
    } catch (err) {
        console.error(err);
        res.redirect('/people?error=Failed to process transfer request');
    }
});

// Delete Staff/Worker
router.post('/delete-person/:id', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    try {
        const userToDelete = await User.findOne({ where: { id: req.params.id, installationId: req.activeInstallationId } });
        
        if (!userToDelete) return res.redirect('/people?error=User not found');

        if (req.session.user.role === 'secretary' && userToDelete.role === 'pastor') {
             return res.redirect('/people?error=Secretaries are not authorized to delete Pastors');
        }

        if (userToDelete.id === req.session.user.id) {
            return res.redirect('/people?error=You cannot delete your own account');
        }

        await userToDelete.destroy();
        res.redirect('/people?success=Person deleted successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/people?error=Failed to delete person');
    }
});

// Delete Church Member
router.post('/delete-member/:id', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    try {
        const memberToDelete = await Member.findOne({ where: { id: req.params.id, installationId: req.activeInstallationId } });
        
        if (!memberToDelete) return res.redirect('/people?error=Member not found');

        await memberToDelete.destroy();
        res.redirect('/people?success=Member deleted successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/people?error=Failed to delete member');
    }
});

module.exports = router;
