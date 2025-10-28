// Authentication middleware
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ message: 'Authentication required' });
}

module.exports = {
    ensureAuthenticated
};