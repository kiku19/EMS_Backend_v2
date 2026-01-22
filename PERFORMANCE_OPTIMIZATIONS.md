# Timetable Management Performance Optimizations

This document describes the performance optimizations implemented for the timetable management system.

## Overview

The following optimizations have been implemented to improve the performance and scalability of the timetable management system:

1. **Database Indexes** - Optimized query performance
2. **In-Memory Caching** - Reduced database load
3. **Lazy Loading** - On-demand data fetching
4. **Debouncing** - Reduced redundant operations
5. **Batch Operations** - Efficient bulk updates

## 1. Database Indexes

### Existing Indexes

The following indexes were already in place in `database.js`:

#### Staff Model
```javascript
staffSchema.index({ 'teacherAssignments.subject': 1 });
staffSchema.index({ 'teacherAssignments.classes': 1 });
```

#### Timetable Model
```javascript
timetableSchema.index({ classId: 1, academicYear: 1 }, { unique: true });
timetableSchema.index({ 'schedule.Monday.teacherId': 1 });
timetableSchema.index({ 'schedule.Tuesday.teacherId': 1 });
timetableSchema.index({ 'schedule.Wednesday.teacherId': 1 });
timetableSchema.index({ 'schedule.Thursday.teacherId': 1 });
timetableSchema.index({ 'schedule.Friday.teacherId': 1 });
timetableSchema.index({ 'schedule.Saturday.teacherId': 1 });
```

#### TeacherTimetable Model
```javascript
teacherTimetableSchema.index({ teacherId: 1, academicYear: 1 }, { unique: true });
```

#### ConflictLog Model
```javascript
conflictLogSchema.index({ teacherId: 1, status: 1 });
conflictLogSchema.index({ detectedAt: -1 });
```

### Benefits
- **Faster Queries**: Indexes on frequently queried fields significantly reduce query time
- **Efficient Lookups**: Teacher assignment queries are optimized with compound indexes
- **Conflict Detection**: Quick lookups for teacher schedules across all days

## 2. In-Memory Caching

### Implementation

A new `CacheService` has been implemented in `backend/services/cacheService.js` that provides:

- **TTL-based caching**: Automatic expiration of cached data
- **Pattern-based invalidation**: Clear related cache entries efficiently
- **Specialized cache keys**: Organized caching for different data types

### Cache Keys

```javascript
// Class and teacher lists
classes:{academicYear}
teachers:{academicYear}

// Timetables
timetable:class:{classId}:{academicYear}
timetable:teacher:{teacherId}:{academicYear}

// Available teachers
available:{classId}:{subject}:{day}:{period}

// Teacher assignments
assignments:{teacherId}

// Conflict checks
conflict:{teacherId}:{day}:{period}:{excludeClassId}
```

### Cache Invalidation

Cache is automatically invalidated when:
- Timetables are updated (class or teacher)
- Teacher assignments are modified
- Slots are added, updated, or deleted

### Usage Example

```javascript
// Get cached timetable
const timetable = await timetableService.getClassTimetable(classId, academicYear);

// Cache is automatically used and invalidated
```

### API Endpoints

```
POST /api/timetable/cache/clear - Clear cache (admin only)
GET  /api/timetable/cache/stats  - Get cache statistics (admin only)
```

### Benefits
- **Reduced Database Load**: Frequently accessed data is served from memory
- **Faster Response Times**: Cache hits are significantly faster than database queries
- **Automatic Management**: TTL and invalidation handle cache freshness

## 3. Lazy Loading

### Implementation

Lazy loading support has been added to the frontend API service:

```javascript
// Load timetable on-demand with cache control
timetableApi.getByClassLazy(classId, academicYear, skipCache)
```

### Benefits
- **On-Demand Loading**: Data is only fetched when needed
- **Cache Control**: Option to skip cache for fresh data
- **Reduced Initial Load**: Faster page loads by deferring non-critical data

### Usage Example

```javascript
// Load timetable when user navigates to the page
const timetable = await timetableApi.getByClassLazy(classId, academicYear);

// Force fresh data (skip cache)
const freshTimetable = await timetableApi.getByClassLazy(classId, academicYear, true);
```

## 4. Debouncing

### Implementation

A debounce utility has been implemented in `backend/utils/debounce.js` with:

- **Standard debounce**: Delay function execution
- **Async debounce**: Handle async functions with promises
- **Throttle**: Limit execution frequency

### Conflict Check Debouncing

Conflict checks are debounced with a 500ms delay to prevent excessive database queries during rapid edits:

```javascript
// In ConflictDetectionService
this.debouncedConflictCheck = debounceAsync(
  this._checkTeacherConflictInternal.bind(this),
  500 // 500ms debounce
);
```

### Benefits
- **Reduced Database Load**: Fewer redundant queries during rapid edits
- **Better User Experience**: Smoother UI without lag from excessive checks
- **Resource Efficiency**: CPU and network resources are conserved

### Usage

```javascript
// Debounced conflict check (default)
const conflict = await conflictDetectionService.checkTeacherConflict(
  teacherId, day, periodIndex, excludeClassId
);

// Skip debounce for immediate check (e.g., batch operations)
const conflict = await conflictDetectionService.checkTeacherConflict(
  teacherId, day, periodIndex, excludeClassId, true
);
```

## 5. Batch Operations

### Implementation

A new `BatchOperationsService` has been implemented in `backend/services/batchOperationsService.js` that provides:

- **Batch slot updates**: Update multiple slots in a single operation
- **Validation before commit**: All slots are validated before any changes
- **Atomic operations**: All-or-nothing updates with rollback on failure
- **Optimized database access**: Single timetable fetch and update

### API Endpoints

```
POST /api/timetable/:classId/batch - Batch update class timetable slots
```

### Request Format

```json
{
  "slots": [
    {
      "day": "Monday",
      "periodIndex": 0,
      "subject": "Mathematics",
      "teacherId": "teacher_id_1",
      "room": "101"
    },
    {
      "day": "Monday",
      "periodIndex": 1,
      "subject": "Science",
      "teacherId": "teacher_id_2",
      "room": "102"
    }
  ],
  "academicYear": "2024-25"
}
```

### Response Format

```json
{
  "success": true,
  "message": "Successfully updated 2 slots",
  "results": {
    "success": [
      { "slot": {...}, "status": "updated" },
      { "slot": {...}, "status": "updated" }
    ],
    "conflicts": [],
    "errors": []
  }
}
```

### Benefits
- **Reduced Round Trips**: Multiple updates in a single request
- **Faster Updates**: Optimized database operations
- **Better Error Handling**: All-or-nothing approach prevents partial updates
- **Conflict Prevention**: All slots validated before any changes

### Usage Example

```javascript
// Update multiple slots at once
const result = await timetableApi.batchUpdateSlots(classId, [
  { day: 'Monday', periodIndex: 0, subject: 'Math', teacherId: 'id1', room: '101' },
  { day: 'Monday', periodIndex: 1, subject: 'Science', teacherId: 'id2', room: '102' },
  { day: 'Tuesday', periodIndex: 0, subject: 'English', teacherId: 'id3', room: '103' }
], academicYear);
```

## Performance Metrics

### Expected Improvements

1. **Query Performance**: 50-80% faster with indexes
2. **Cache Hit Rate**: 60-80% for frequently accessed data
3. **Conflict Checks**: 70% reduction in database queries with debouncing
4. **Batch Operations**: 5-10x faster than individual updates
5. **Page Load Time**: 30-50% faster with lazy loading

### Monitoring

Monitor performance using:

```javascript
// Get cache statistics
const stats = await timetableApi.getCacheStats();
console.log('Cache size:', stats.size);
console.log('Cached keys:', stats.keys);
```

## Best Practices

### For Developers

1. **Use Lazy Loading**: Load data on-demand rather than upfront
2. **Leverage Caching**: Use cached data when freshness isn't critical
3. **Batch Updates**: Group multiple updates into batch operations
4. **Skip Debounce When Needed**: Use `skipDebounce` flag for critical operations

### For Administrators

1. **Monitor Cache**: Check cache statistics regularly
2. **Clear Cache**: Clear cache after major data migrations
3. **Database Maintenance**: Ensure indexes are maintained
4. **Performance Testing**: Test with realistic data volumes

## Configuration

### Cache TTL

Default TTL values can be adjusted in `cacheService.js`:

```javascript
this.defaultTTL = 5 * 60 * 1000; // 5 minutes
```

Specific cache durations:
- Timetables: 2 minutes
- Conflict checks: 30 seconds
- Class/Teacher lists: 5 minutes

### Debounce Delay

Debounce delay can be adjusted in `conflictDetectionService.js`:

```javascript
this.debouncedConflictCheck = debounceAsync(
  this._checkTeacherConflictInternal.bind(this),
  500 // Adjust this value (in milliseconds)
);
```

## Troubleshooting

### Cache Issues

If data appears stale:
1. Clear cache: `POST /api/timetable/cache/clear`
2. Use `skipCache` option in API calls
3. Check cache statistics for anomalies

### Performance Issues

If performance degrades:
1. Check database indexes are present
2. Monitor cache hit rate
3. Review debounce settings
4. Check for excessive batch sizes

## Future Enhancements

Potential future optimizations:

1. **Redis Integration**: Replace in-memory cache with Redis for distributed caching
2. **Query Optimization**: Further optimize complex queries
3. **Pagination**: Add pagination for large timetable lists
4. **Compression**: Compress cached data to reduce memory usage
5. **CDN Integration**: Cache static timetable data on CDN
