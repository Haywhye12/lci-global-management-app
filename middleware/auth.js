// Auth Middleware: Protects routes and provides user/installation context to views
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        // Multi-tenant subdomain isolation
        if (!['superadmin', 'global_auditor', 'tech_support'].includes(req.session.user.role)) {
            if (req.tenant && req.session.user.installationId !== req.tenant.id) {
                const targetSubdomain = req.session.user.installationSubdomain;
                if (targetSubdomain) {
                    const host = req.headers.host || '';
                    const parts = host.split('.');
                    let mainDomain = host;
                    if (parts.length > 1 && parts[parts.length - 1].split(':')[0] === 'localhost') {
                        mainDomain = parts[parts.length - 1];
                    } else if (parts.length > 2) {
                        mainDomain = parts.slice(1).join('.');
                    }
                    return res.redirect(`${req.protocol}://${targetSubdomain}.${mainDomain}${req.originalUrl}`);
                }
                return res.status(403).render('error', { 
                    message: 'Access Denied: You do not have permission to access this branch portal.' 
                });
            }
        }

        // Determine active installation ID
        const activeInstId = (req.session.user.role === 'superadmin' && req.session.selectedInstallationId) 
            ? req.session.selectedInstallationId 
            : (req.tenant ? req.tenant.id : req.session.user.installationId);
            
        const activeInstName = (req.session.user.role === 'superadmin' && req.session.selectedInstallationName)
            ? req.session.selectedInstallationName
            : (req.tenant ? req.tenant.name : req.session.user.installationName);

        req.activeInstallationId = activeInstId;

        // Make user and installation info available to all templates
        res.locals.user = req.session.user;
        res.locals.installation = {
            id: activeInstId,
            name: activeInstName
        };
        
        // Expose a flag if we are currently "viewing as" another installation
        res.locals.isViewingAs = (req.session.user.role === 'superadmin' && req.session.selectedInstallationId && req.session.selectedInstallationId !== req.session.user.installationId);

        return next();
    }
    res.redirect('/auth/login');
};

// Role Middleware: Checks if user has specific roles
const authorize = (roles = []) => {
    if (typeof roles === 'string') {
        roles = [roles];
    }

    return (req, res, next) => {
        if (!req.session.user || (roles.length && !roles.includes(req.session.user.role))) {
            return res.status(401).render('error', { message: 'Unauthorized Access: Invalid Role Permissions' });
        }
        next();
    };
};

module.exports = { isAuthenticated, authorize };
