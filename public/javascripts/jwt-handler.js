// JWT Token Manager - Client-side JWT handling
class JWTHandler {
    constructor() {
        this.tokenKey = 'authToken';
        this.userKey = 'authUser';
    }

    /**
     * Store JWT token in localStorage
     * @param {string} token - JWT token from server
     */
    setToken(token) {
        localStorage.setItem(this.tokenKey, token);
    }

    /**
     * Get JWT token from localStorage
     * @returns {string|null} - JWT token or null if not found
     */
    getToken() {
        return localStorage.getItem(this.tokenKey);
    }

    /**
     * Check if token exists
     * @returns {boolean} - True if token exists
     */
    hasToken() {
        return !!this.getToken();
    }

    /**
     * Remove JWT token from localStorage
     */
    removeToken() {
        localStorage.removeItem(this.tokenKey);
    }

    /**
     * Store user data in localStorage
     * @param {object} user - User object from JWT token
     */
    setUser(user) {
        localStorage.setItem(this.userKey, JSON.stringify(user));
    }

    /**
     * Get user data from localStorage
     * @returns {object|null} - User object or null if not found
     */
    getUser() {
        const user = localStorage.getItem(this.userKey);
        return user ? JSON.parse(user) : null;
    }

    /**
     * Remove user data from localStorage
     */
    removeUser() {
        localStorage.removeItem(this.userKey);
    }

    /**
     * Attach JWT token to API requests
     * @param {object} headers - Request headers object
     * @returns {object} - Headers with JWT token attached
     */
    attachTokenToHeaders(headers = {}) {
        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    /**
     * Make authenticated API request
     * @param {string} url - API endpoint
     * @param {object} options - Fetch options
     * @returns {Promise} - Fetch promise
     */
    async authenticatedFetch(url, options = {}) {
        options.headers = this.attachTokenToHeaders(options.headers || {});
        
        const response = await fetch(url, options);
        
        // If 401 Unauthorized, clear token and redirect to login
        if (response.status === 401) {
            this.clearAuth();
            window.location.href = '/login';
        }
        
        return response;
    }

    /**
     * Clear all authentication data
     */
    clearAuth() {
        this.removeToken();
        this.removeUser();
    }

    /**
     * Helper function to decode JWT (without verification - for client-side only)
     * @param {string} token - JWT token
     * @returns {object|null} - Decoded payload or null
     */
    decodeToken(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(jsonPayload);
        } catch (error) {
            console.error('Error decoding token:', error);
            return null;
        }
    }

    /**
     * Check if JWT token is expired
     * @returns {boolean} - True if token is expired
     */
    isTokenExpired() {
        const token = this.getToken();
        if (!token) return true;
        
        const decoded = this.decodeToken(token);
        if (!decoded || !decoded.exp) return true;
        
        // exp is in seconds, Date.now() is in milliseconds
        return decoded.exp * 1000 < Date.now();
    }

    /**
     * Login and store token and user data
     * @param {string} email - User email
     * @param {string} password - User password
     * @returns {Promise} - Login response
     */
    async login(email, password) {
        try {
            const response = await fetch('/login/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            if (!response.ok) {
                throw new Error('Login failed');
            }

            const data = await response.json();
            
            if (data.success && data.token) {
                this.setToken(data.token);
                
                const decoded = this.decodeToken(data.token);
                if (decoded) {
                    this.setUser(decoded);
                }
                
                return { success: true, data };
            }
            
            throw new Error(data.message || 'Login failed');
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Logout and clear all authentication data
     * @returns {Promise} - Logout response
     */
    async logout() {
        try {
            const response = await this.authenticatedFetch('/login/logout', {
                method: 'GET'
            });

            const data = await response.json();
            this.clearAuth();
            
            return { success: true, data };
        } catch (error) {
            console.error('Logout error:', error);
            this.clearAuth();
            return { success: false, error: error.message };
        }
    }
}

// Create global instance
const jwtHandler = new JWTHandler();

// Auto-attach token to all fetch requests
const originalFetch = window.fetch;
window.fetch = function(...args) {
    let [resource, config] = args;
    
    // Only attach token to API calls (not to static assets, images, etc.)
    if (typeof resource === 'string' && 
        (resource.startsWith('/') || resource.includes('/api/')) &&
        !resource.includes('.css') && 
        !resource.includes('.js') && 
        !resource.includes('.png') &&
        !resource.includes('.jpg') &&
        !resource.includes('.gif')) {
        
        config = config || {};
        config.headers = jwtHandler.attachTokenToHeaders(config.headers || {});
    }
    
    return originalFetch.apply(this, [resource, config]);
};
