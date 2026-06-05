const express = require('express');
const router = express.Router();
const { Attendance, Finance, sequelize } = require('../models');
const { isAuthenticated, authorize } = require('../middleware/auth');
const { Op } = require('sequelize');

// Utility to convert Array of Objects to CSV string
function toCSV(data, headers) {
    if (!data || !data.length) return headers.join(',') + '\nNo data available for this period.';
    
    const rows = [headers.join(',')];
    
    for (const row of data) {
        const values = headers.map(header => {
            let val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
            // Escape quotes and wrap in quotes if contains comma
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = '"' + val.replace(/"/g, '""') + '"';
            }
            return val;
        });
        rows.push(values.join(','));
    }
    
    return rows.join('\n');
}

router.get('/', isAuthenticated, authorize(['superadmin', 'admin', 'pastor', 'secretary']), async (req, res) => {
    try {
        const { type, month, year } = req.query;

        if (!type || !month || !year) {
            return res.render('export', { title: 'Export Reports' });
        }

        const formattedMonth = String(month).padStart(2, '0');
        const installationId = req.activeInstallationId;
        
        let csvData = '';
        let filename = '';

        if (type === 'attendance') {
            // ServiceDate is DATEONLY, format: YYYY-MM-DD
            const startDate = `${year}-${formattedMonth}-01`;
            const endDate = new Date(year, parseInt(month), 0).toISOString().split('T')[0]; // Last day of month

            const attendanceRecords = await Attendance.findAll({
                where: {
                    installationId,
                    serviceDate: {
                        [Op.between]: [startDate, endDate]
                    }
                },
                order: [['serviceDate', 'ASC']]
            });

            const rawData = attendanceRecords.map(r => r.get({ plain: true }));
            const headers = ['serviceDate', 'serviceType', 'weekNumber', 'male', 'female', 'child', 'total', 'specialProgram', 'comments', 'testimony'];
            csvData = toCSV(rawData, headers);
            filename = `Attendance_Report_${year}_${formattedMonth}.csv`;

        } else if (type === 'finance') {
            // Period is STRING, format: YYYY-MM
            const periodStr = `${year}-${formattedMonth}`;
            
            const financeRecords = await Finance.findAll({
                where: {
                    installationId,
                    period: periodStr
                },
                order: [['weekNumber', 'ASC']]
            });

            const rawData = financeRecords.map(r => r.get({ plain: true }));
            const headers = ['period', 'weekNumber', 'tithes', 'offering', 'specialCollection', 'totalIncome', 'totalExpenditure'];
            csvData = toCSV(rawData, headers);
            filename = `Finance_Report_${year}_${formattedMonth}.csv`;

        } else {
            return res.status(400).send('Invalid report type');
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvData);

    } catch (err) {
        console.error('Export Error:', err);
        res.status(500).send('Failed to generate export');
    }
});

module.exports = router;
