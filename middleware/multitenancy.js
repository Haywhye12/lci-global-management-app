const { Installation } = require('../models');

module.exports = async (req, res, next) => {
    const host = req.headers.host ? req.headers.host.split(':')[0] : '';
    const parts = host.split('.');
    let subdomain = null;

    if (parts.length > 1 && parts[parts.length - 1] === 'localhost') {
        subdomain = parts[0];
    } else if (parts.length > 2) {
        subdomain = parts[0];
    }

    try {
        let tenant = null;
        let isTenantResolvedBySubdomain = false;

        if (subdomain && subdomain !== 'www') {
            if (subdomain === 'hq') {
                tenant = await Installation.findOne({ where: { subdomain: 'hq' } });
                if (tenant) {
                    isTenantResolvedBySubdomain = true;
                }
            } else {
                tenant = await Installation.findOne({ where: { subdomain, status: 'active' } });
                if (tenant) {
                    isTenantResolvedBySubdomain = true;
                }
            }
        }

        if (!tenant) {
            // Default to HQ branch if no subdomain is present or if it did not match any tenant
            tenant = await Installation.findOne({ where: { subdomain: 'hq' } });
            if (!tenant) {
                // Absolute fallback to first active installation
                tenant = await Installation.findOne({ where: { status: 'active' } });
            }
        }

        req.tenant = tenant;
        req.isTenantResolvedBySubdomain = isTenantResolvedBySubdomain;
        res.locals.tenant = tenant ? tenant.get({ plain: true }) : null;

        if (tenant) {
            res.locals.currencySymbol = tenant.currency === 'GBP' ? '£' : '₦';
            res.locals.currencyCode = tenant.currency;
            res.locals.timezone = tenant.timezone;
        } else {
            res.locals.currencySymbol = '₦';
            res.locals.currencyCode = 'NGN';
            res.locals.timezone = 'Africa/Lagos';
        }

        next();
    } catch (err) {
        console.error('Multi-tenancy resolution error:', err);
        next();
    }
};
