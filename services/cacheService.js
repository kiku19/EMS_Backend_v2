/**
 * Cache Service for Timetable Management
 * Implements in-memory caching for frequently accessed data
 */

class CacheService {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map(); // Time-to-live for cache entries
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes default TTL
  }

  /**
   * Set a value in cache with optional TTL
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  set(key, value, ttl = this.defaultTTL) {
    this.cache.set(key, value);
    
    if (ttl > 0) {
      const expiryTime = Date.now() + ttl;
      this.ttl.set(key, expiryTime);
      
      // Auto-cleanup after TTL
      setTimeout(() => {
        this.delete(key);
      }, ttl);
    }
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if not found or expired
   */
  get(key) {
    // Check if key exists
    if (!this.cache.has(key)) {
      return null;
    }

    // Check if expired
    const expiryTime = this.ttl.get(key);
    if (expiryTime && Date.now() > expiryTime) {
      this.delete(key);
      return null;
    }

    return this.cache.get(key);
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
    this.ttl.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.ttl.clear();
  }

  /**
   * Invalidate cache entries matching a pattern
   * @param {string} pattern - Pattern to match (supports wildcards with *)
   */
  invalidatePattern(pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const keysToDelete = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
    return keysToDelete.length;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Generate cache key for class list
   * @param {string} academicYear - Academic year
   * @returns {string} Cache key
   */
  getClassListKey(academicYear) {
    return `classes:${academicYear}`;
  }

  /**
   * Generate cache key for teacher list
   * @param {string} academicYear - Academic year
   * @returns {string} Cache key
   */
  getTeacherListKey(academicYear) {
    return `teachers:${academicYear}`;
  }

  /**
   * Generate cache key for class timetable
   * @param {string} classId - Class ID
   * @param {string} academicYear - Academic year
   * @returns {string} Cache key
   */
  getClassTimetableKey(classId, academicYear) {
    return `timetable:class:${classId}:${academicYear}`;
  }

  /**
   * Generate cache key for teacher timetable
   * @param {string} teacherId - Teacher ID
   * @param {string} academicYear - Academic year
   * @returns {string} Cache key
   */
  getTeacherTimetableKey(teacherId, academicYear) {
    return `timetable:teacher:${teacherId}:${academicYear}`;
  }

  /**
   * Generate cache key for available teachers
   * @param {string} classId - Class ID
   * @param {string} subject - Subject
   * @param {string} day - Day of week
   * @param {number} period - Period index
   * @returns {string} Cache key
   */
  getAvailableTeachersKey(classId, subject, day, period) {
    return `available:${classId}:${subject}:${day}:${period}`;
  }

  /**
   * Generate cache key for teacher assignments
   * @param {string} teacherId - Teacher ID
   * @returns {string} Cache key
   */
  getTeacherAssignmentsKey(teacherId) {
    return `assignments:${teacherId}`;
  }

  /**
   * Invalidate all timetable-related cache
   * @param {string} academicYear - Academic year (optional)
   */
  invalidateTimetableCache(academicYear = '*') {
    this.invalidatePattern(`timetable:*:${academicYear}`);
    this.invalidatePattern(`available:*`);
  }

  /**
   * Invalidate class-related cache
   * @param {string} classId - Class ID
   */
  invalidateClassCache(classId) {
    this.invalidatePattern(`timetable:class:${classId}:*`);
    this.invalidatePattern(`available:${classId}:*`);
  }

  /**
   * Invalidate teacher-related cache
   * @param {string} teacherId - Teacher ID
   */
  invalidateTeacherCache(teacherId) {
    this.invalidatePattern(`timetable:teacher:${teacherId}:*`);
    this.invalidatePattern(`assignments:${teacherId}`);
    this.invalidatePattern(`conflict:${teacherId}:*`); // Invalidate conflict cache
    this.invalidatePattern(`available:*`); // Teacher availability affects all classes
  }
}

export default new CacheService();
