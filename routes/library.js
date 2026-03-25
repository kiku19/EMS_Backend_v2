import express from 'express';
import { z } from 'zod';
import Book from '../models/Book.js';
import BookIssue from '../models/BookIssue.js';
import BookCopy from '../models/BookCopy.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const bookSchema = z.object({
  title: z.string().min(1).max(300).trim(),
  author: z.string().min(1).max(200).trim(),
  isbn: z.string().trim().optional(),
  publisher: z.string().trim().optional(),
  publishedYear: z
    .number()
    .int()
    .min(1000)
    .max(new Date().getFullYear() + 1)
    .optional(),
  edition: z.string().trim().optional(),
  category: z
    .enum(['textbook', 'reference', 'fiction', 'non-fiction', 'periodical', 'digital', 'other'])
    .optional(),
  subject: z.string().trim().optional(),
  language: z.string().trim().optional(),
  description: z.string().trim().optional(),
  totalCopies: z.number().int().min(1),
  rackNumber: z.string().trim().optional(),
  shelfNumber: z.string().trim().optional(),
  digitalUrl: z.string().url().optional().or(z.literal('')),
  finePerDay: z.number().min(0).optional(),
  coverImageUrl: z.string().trim().optional(),
});

const issueBookSchema = z.object({
  bookId: z.string().min(1),
  studentId: z.string().min(1),
  dueDate: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  notes: z.string().trim().optional(),
});

const returnBookSchema = z.object({
  finePaid: z.boolean().optional(),
  notes: z.string().trim().optional(),
  returnCondition: z.enum(['new', 'good', 'fair', 'worn', 'damaged', 'lost']).optional(),
});

const addCopySchema = z.object({
  copyNumber: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  condition: z.enum(['new', 'good', 'fair', 'worn', 'damaged', 'lost']).optional(),
  notes: z.string().trim().optional(),
});

const updateCopySchema = z.object({
  condition: z.enum(['new', 'good', 'fair', 'worn', 'damaged', 'lost']).optional(),
  barcode: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const reserveBookSchema = z.object({
  bookId: z.string().min(1),
  studentId: z.string().min(1),
  notes: z.string().trim().optional(),
});

// ─── Books: CRUD ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/library/books
 * List books with optional search/category/availability filters
 */
router.get('/books', authenticate, checkPermission('library', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const {
      search,
      category,
      available,
      author,
      isbn,
      availability,
      page = 1,
      limit = 50,
    } = req.query;

    const query = buildSchoolScopedQuery(schoolId, { isActive: true });

    if (category) query.category = category;
    if (available === 'true') query.availableCopies = { $gt: 0 };

    // Advanced filters
    if (author) query.author = new RegExp(author.trim(), 'i');
    if (isbn) query.isbn = new RegExp(isbn.trim(), 'i');
    if (availability === 'available') query.availableCopies = { $gt: 0 };
    else if (availability === 'unavailable') query.availableCopies = 0;

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ title: regex }, { author: regex }, { isbn: regex }, { subject: regex }];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [books, total] = await Promise.all([
      Book.find(query).sort({ title: 1 }).skip(skip).limit(parseInt(limit)),
      Book.countDocuments(query),
    ]);

    res.json({ books, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/library/books/low-stock
 * Books with availableCopies <= 2
 */
router.get(
  '/books/low-stock',
  authenticate,
  checkPermission('library', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const query = buildSchoolScopedQuery(schoolId, {
        isActive: true,
        availableCopies: { $lte: 2 },
      });
      const books = await Book.find(query).sort({ availableCopies: 1 });
      res.json({ books });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/v1/library/books/:id
 */
router.get('/books/:id', authenticate, checkPermission('library', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const book = await Book.findOne(buildSchoolScopedQuery(schoolId, { _id: req.params.id }));
    if (!book) return res.status(404).json({ error: req.t('common:routes.bookNotFound') });
    res.json({ book });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/library/books
 */
router.post('/books', authenticate, checkPermission('library', 'create'), async (req, res) => {
  try {
    const data = bookSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const book = new Book({
      ...data,
      availableCopies: data.totalCopies,
      schoolId,
    });

    await book.save();

    // Auto-create individual copy records
    const copies = [];
    for (let i = 1; i <= data.totalCopies; i++) {
      copies.push({
        schoolId,
        bookId: book._id,
        copyNumber: String(i).padStart(3, '0'),
        condition: 'good',
        status: 'available',
        isActive: true,
      });
    }
    await BookCopy.insertMany(copies);

    res.status(201).json({ book });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/library/books/:id
 */
router.put('/books/:id', authenticate, checkPermission('library', 'edit'), async (req, res) => {
  try {
    const data = bookSchema.partial().parse(req.body);
    const schoolId = req.user.schoolId;

    const book = await Book.findOne(buildSchoolScopedQuery(schoolId, { _id: req.params.id }));
    if (!book) return res.status(404).json({ error: req.t('common:routes.bookNotFound') });

    // Adjust available copies if total changes
    if (data.totalCopies !== undefined && data.totalCopies !== book.totalCopies) {
      const diff = data.totalCopies - book.totalCopies;
      data.availableCopies = Math.max(0, book.availableCopies + diff);

      if (diff > 0) {
        // Create new individual copy records
        const existingCount = await BookCopy.countDocuments({ schoolId, bookId: book._id });
        const newCopies = [];
        for (let i = 1; i <= diff; i++) {
          newCopies.push({
            schoolId,
            bookId: book._id,
            copyNumber: String(existingCount + i).padStart(3, '0'),
            condition: 'good',
            status: 'available',
            isActive: true,
          });
        }
        await BookCopy.insertMany(newCopies);
      } else if (diff < 0) {
        // Decommission available copies (most recently added first)
        const toDecommission = Math.abs(diff);
        const availCopies = await BookCopy.find(
          buildSchoolScopedQuery(schoolId, {
            bookId: book._id,
            status: 'available',
            isActive: true,
          })
        )
          .sort({ createdAt: -1 })
          .limit(toDecommission);
        if (availCopies.length > 0) {
          await BookCopy.updateMany(
            { _id: { $in: availCopies.map((c) => c._id) } },
            { $set: { status: 'decommissioned', isActive: false } }
          );
        }
      }
    }

    Object.assign(book, data);
    await book.save();
    res.json({ book });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/library/books/:id
 * Soft delete
 */
router.delete(
  '/books/:id',
  authenticate,
  checkPermission('library', 'delete'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const book = await Book.findOne(buildSchoolScopedQuery(schoolId, { _id: req.params.id }));
      if (!book) return res.status(404).json({ error: req.t('common:routes.bookNotFound') });

      // Check no active issues
      const activeIssues = await BookIssue.countDocuments(
        buildSchoolScopedQuery(schoolId, {
          bookId: req.params.id,
          status: { $in: ['issued', 'overdue', 'reserved'] },
        })
      );
      if (activeIssues > 0) {
        return res
          .status(400)
          .json({ error: req.t('common:routes.cannotDeleteBookWithActiveIssuesOrReservations') });
      }

      book.isActive = false;
      await book.save();
      res.json({ message: req.t('common:routes.bookDeleted') });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Issue / Return ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/library/issues
 * List issued books with filters
 */
router.get('/issues', authenticate, checkPermission('library', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { status, studentId, bookId, overdue, page = 1, limit = 50 } = req.query;

    const query = buildSchoolScopedQuery(schoolId, {});
    if (status) query.status = status;
    if (studentId) query.studentId = studentId;
    if (bookId) query.bookId = bookId;
    if (overdue === 'true') {
      query.dueDate = { $lt: new Date() };
      query.status = 'issued';
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [issues, total] = await Promise.all([
      BookIssue.find(query)
        .populate('bookId', 'title isbn author')
        .populate('studentId', 'name admissionNo rollNo')
        .sort({ issueDate: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      BookIssue.countDocuments(query),
    ]);

    // Compute accrued fine for issued/overdue books not yet returned
    const now = new Date();
    const enriched = issues.map((issue) => {
      const obj = issue.toObject();
      const dueDate = new Date(issue.dueDate);
      if (
        (issue.status === 'issued' || issue.status === 'overdue') &&
        dueDate < now &&
        issue.finePerDay > 0
      ) {
        const daysLate = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
        obj.accruedFine = daysLate * issue.finePerDay;
      } else {
        obj.accruedFine = 0;
      }
      return obj;
    });

    res.json({ issues: enriched, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/library/issues
 * Issue a book to a student
 */
router.post('/issues', authenticate, checkPermission('library', 'create'), async (req, res) => {
  try {
    const { bookId, studentId, dueDate, notes } = issueBookSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const book = await Book.findOne(
      buildSchoolScopedQuery(schoolId, { _id: bookId, isActive: true })
    );
    if (!book) return res.status(404).json({ error: req.t('common:routes.bookNotFound') });
    if (book.availableCopies < 1)
      return res.status(400).json({ error: req.t('common:routes.noCopiesAvailable') });

    // Check student doesn't already have this book issued
    const existing = await BookIssue.findOne(
      buildSchoolScopedQuery(schoolId, {
        bookId,
        studentId,
        status: { $in: ['issued', 'overdue'] },
      })
    );
    if (existing)
      return res
        .status(400)
        .json({ error: req.t('common:routes.studentAlreadyHasThisBookIssued') });

    // Auto-assign first available copy
    const availableCopy = await BookCopy.findOne(
      buildSchoolScopedQuery(schoolId, { bookId, status: 'available', isActive: true })
    );

    const issue = new BookIssue({
      schoolId,
      bookId,
      bookTitle: book.title,
      bookIsbn: book.isbn,
      studentId,
      issuedBy: req.user._id || req.user.id,
      issuedByName: req.user.name,
      issueDate: new Date(),
      dueDate: new Date(dueDate),
      status: 'issued',
      finePerDay: book.finePerDay,
      notes,
      ...(availableCopy ? { copyId: availableCopy._id, copyNumber: availableCopy.copyNumber } : {}),
    });

    book.availableCopies -= 1;

    const saveOps = [issue.save(), book.save()];
    if (availableCopy) {
      availableCopy.status = 'issued';
      saveOps.push(availableCopy.save());
    }
    await Promise.all(saveOps);

    const populated = await issue.populate([
      { path: 'bookId', select: 'title isbn author' },
      { path: 'studentId', select: 'name admissionNo rollNo' },
    ]);

    res.status(201).json({ issue: populated });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/library/issues/:id/return
 * Return a book
 */
router.put(
  '/issues/:id/return',
  authenticate,
  checkPermission('library', 'edit'),
  async (req, res) => {
    try {
      const { finePaid, notes, returnCondition } = returnBookSchema.parse(req.body);
      const schoolId = req.user.schoolId;

      const issue = await BookIssue.findOne(
        buildSchoolScopedQuery(schoolId, {
          _id: req.params.id,
          status: { $in: ['issued', 'overdue'] },
        })
      );
      if (!issue)
        return res.status(404).json({ error: req.t('common:routes.activeIssueNotFound') });

      const returnDate = new Date();
      const dueDate = new Date(issue.dueDate);

      // Calculate fine
      let fineAmount = 0;
      if (returnDate > dueDate) {
        const daysLate = Math.ceil((returnDate - dueDate) / (1000 * 60 * 60 * 24));
        const book = await Book.findById(issue.bookId);
        const finePerDay = book?.finePerDay || 0;
        fineAmount = daysLate * finePerDay;
      }

      issue.returnDate = returnDate;
      issue.status = 'returned';
      issue.fineAmount = fineAmount;
      if (finePaid !== undefined) issue.finePaid = finePaid;
      if (finePaid) issue.finePaidDate = returnDate;
      if (notes) issue.notes = notes;
      if (returnCondition) issue.returnCondition = returnCondition;

      // Return copy to available stock
      await Book.findByIdAndUpdate(issue.bookId, { $inc: { availableCopies: 1 } });
      await issue.save();

      // Release and update the individual copy
      if (issue.copyId) {
        const copyUpdate = { status: 'available' };
        if (returnCondition) copyUpdate.condition = returnCondition;
        await BookCopy.findByIdAndUpdate(issue.copyId, { $set: copyUpdate });
      }

      res.json({ issue, fineAmount });
    } catch (error) {
      if (error.name === 'ZodError') {
        return res
          .status(400)
          .json({ error: req.t('common:routes.validationFailed'), details: error.errors });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/v1/library/issues/reserve
 * Reserve a book for a student
 */
router.post(
  '/issues/reserve',
  authenticate,
  checkPermission('library', 'create'),
  async (req, res) => {
    try {
      const { bookId, studentId, notes } = reserveBookSchema.parse(req.body);
      const schoolId = req.user.schoolId;

      const book = await Book.findOne(
        buildSchoolScopedQuery(schoolId, { _id: bookId, isActive: true })
      );
      if (!book) return res.status(404).json({ error: req.t('common:routes.bookNotFound') });

      // Check no existing reservation
      const existing = await BookIssue.findOne(
        buildSchoolScopedQuery(schoolId, { bookId, studentId, status: 'reserved' })
      );
      if (existing)
        return res
          .status(400)
          .json({ error: req.t('common:routes.studentAlreadyHasAReservationForThisBook') });

      const reservation = new BookIssue({
        schoolId,
        bookId,
        bookTitle: book.title,
        bookIsbn: book.isbn,
        studentId,
        issuedBy: req.user._id || req.user.id,
        issuedByName: req.user.name,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days to claim
        status: 'reserved',
        notes,
      });

      book.reservedCopies = (book.reservedCopies || 0) + 1;

      await Promise.all([reservation.save(), book.save()]);

      res.status(201).json({ reservation });
    } catch (error) {
      if (error.name === 'ZodError') {
        return res
          .status(400)
          .json({ error: req.t('common:routes.validationFailed'), details: error.errors });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/v1/library/issues/:id/cancel
 * Cancel a reservation
 */
router.put(
  '/issues/:id/cancel',
  authenticate,
  checkPermission('library', 'edit'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const issue = await BookIssue.findOne(
        buildSchoolScopedQuery(schoolId, { _id: req.params.id, status: 'reserved' })
      );
      if (!issue)
        return res.status(404).json({ error: req.t('common:routes.reservationNotFound') });

      issue.status = 'cancelled';
      await Book.findByIdAndUpdate(issue.bookId, { $inc: { reservedCopies: -1 } });
      await issue.save();

      res.json({ message: req.t('common:routes.reservationCancelled') });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Student History ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/library/students/:studentId/history
 * Full reading history for a student
 */
router.get(
  '/students/:studentId/history',
  authenticate,
  checkPermission('library', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const { studentId } = req.params;

      const issues = await BookIssue.find(buildSchoolScopedQuery(schoolId, { studentId }))
        .populate('bookId', 'title isbn author category coverImageUrl')
        .sort({ issueDate: -1 });

      res.json({ issues });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Overdue Sync ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/library/sync-overdue
 * Mark issued books past due date as overdue
 */
router.post('/sync-overdue', authenticate, checkPermission('library', 'edit'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const result = await BookIssue.updateMany(
      buildSchoolScopedQuery(schoolId, { status: 'issued', dueDate: { $lt: new Date() } }),
      { $set: { status: 'overdue' } }
    );
    res.json({ updated: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/library/stats
 */
router.get('/stats', authenticate, checkPermission('library', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    const [totalBooks, totalCopies, issued, overdue, reserved, lowStock, accruedFinesResult] =
      await Promise.all([
        Book.countDocuments(buildSchoolScopedQuery(schoolId, { isActive: true })),
        Book.aggregate([
          { $match: buildSchoolScopedQuery(schoolId, { isActive: true }) },
          {
            $group: {
              _id: null,
              total: { $sum: '$totalCopies' },
              available: { $sum: '$availableCopies' },
            },
          },
        ]),
        BookIssue.countDocuments(buildSchoolScopedQuery(schoolId, { status: 'issued' })),
        BookIssue.countDocuments(buildSchoolScopedQuery(schoolId, { status: 'overdue' })),
        BookIssue.countDocuments(buildSchoolScopedQuery(schoolId, { status: 'reserved' })),
        Book.countDocuments(
          buildSchoolScopedQuery(schoolId, { isActive: true, availableCopies: { $lte: 2 } })
        ),
        // Total accrued fines for all outstanding overdue issues
        BookIssue.aggregate([
          {
            $match: buildSchoolScopedQuery(schoolId, {
              status: { $in: ['issued', 'overdue'] },
              dueDate: { $lt: new Date() },
              finePerDay: { $gt: 0 },
            }),
          },
          {
            $project: {
              accruedFine: {
                $multiply: [
                  { $ceil: { $divide: [{ $subtract: [new Date(), '$dueDate'] }, 86400000] } },
                  '$finePerDay',
                ],
              },
            },
          },
          { $group: { _id: null, total: { $sum: '$accruedFine' } } },
        ]),
      ]);

    res.json({
      totalBooks,
      totalCopies: totalCopies[0]?.total || 0,
      availableCopies: totalCopies[0]?.available || 0,
      issued,
      overdue,
      reserved,
      lowStock,
      totalAccruedFines: accruedFinesResult[0]?.total || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Reports ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/library/reports
 * Most borrowed books, category-wise stats, overdue summary
 */
router.get('/reports', authenticate, checkPermission('library', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    const [mostBorrowed, categoryStats, overdueByStudent, totalFinesUnpaid] = await Promise.all([
      // Top 10 most borrowed books
      BookIssue.aggregate([
        {
          $match: buildSchoolScopedQuery(schoolId, {
            status: { $in: ['issued', 'returned', 'overdue'] },
          }),
        },
        {
          $group: {
            _id: '$bookId',
            count: { $sum: 1 },
            bookTitle: { $first: '$bookTitle' },
            bookIsbn: { $first: '$bookIsbn' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      // Books by category
      Book.aggregate([
        { $match: buildSchoolScopedQuery(schoolId, { isActive: true }) },
        {
          $group: {
            _id: '$category',
            totalBooks: { $sum: 1 },
            totalCopies: { $sum: '$totalCopies' },
            availableCopies: { $sum: '$availableCopies' },
          },
        },
        { $sort: { totalBooks: -1 } },
      ]),
      // Overdue books by student (top 10)
      BookIssue.aggregate([
        { $match: buildSchoolScopedQuery(schoolId, { status: 'overdue' }) },
        {
          $group: {
            _id: '$studentId',
            count: { $sum: 1 },
            studentName: { $first: '$studentName' },
            admissionNo: { $first: '$studentAdmissionNo' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      // Total unpaid fines
      BookIssue.aggregate([
        { $match: buildSchoolScopedQuery(schoolId, { fineAmount: { $gt: 0 }, finePaid: false }) },
        { $group: { _id: null, total: { $sum: '$fineAmount' }, count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      mostBorrowed,
      categoryStats,
      overdueByStudent,
      unpaidFines: {
        total: totalFinesUnpaid[0]?.total || 0,
        count: totalFinesUnpaid[0]?.count || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Library Card ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/library/students/:studentId/card
 * Library card data for a student
 */
router.get(
  '/students/:studentId/card',
  authenticate,
  checkPermission('library', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const { studentId } = req.params;

      const [activeIssues, totalBorrowed] = await Promise.all([
        BookIssue.find(
          buildSchoolScopedQuery(schoolId, {
            studentId,
            status: { $in: ['issued', 'overdue', 'reserved'] },
          })
        )
          .populate('bookId', 'title isbn author category')
          .sort({ issueDate: -1 }),
        BookIssue.countDocuments(
          buildSchoolScopedQuery(schoolId, {
            studentId,
            status: { $in: ['issued', 'returned', 'overdue'] },
          })
        ),
      ]);

      const unpaidFines = activeIssues
        .filter((i) => i.fineAmount > 0 && !i.finePaid)
        .reduce((sum, i) => sum + i.fineAmount, 0);

      // Compute accrued fines for currently outstanding overdue issues
      const now = new Date();
      const accruedFines = activeIssues.reduce((sum, i) => {
        const dueDate = new Date(i.dueDate);
        if (
          (i.status === 'issued' || i.status === 'overdue') &&
          dueDate < now &&
          i.finePerDay > 0
        ) {
          const daysLate = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
          return sum + daysLate * i.finePerDay;
        }
        return sum;
      }, 0);

      res.json({ studentId, activeIssues, totalBorrowed, unpaidFines, accruedFines });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Book Copies ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/library/books/:id/copies
 * List all individual copies for a book
 */
router.get(
  '/books/:id/copies',
  authenticate,
  checkPermission('library', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const copies = await BookCopy.find(
        buildSchoolScopedQuery(schoolId, { bookId: req.params.id, isActive: true })
      ).sort({ copyNumber: 1 });
      res.json({ copies });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/v1/library/books/:id/copies
 * Add a single physical copy to a book
 */
router.post(
  '/books/:id/copies',
  authenticate,
  checkPermission('library', 'create'),
  async (req, res) => {
    try {
      const data = addCopySchema.parse(req.body);
      const schoolId = req.user.schoolId;

      const book = await Book.findOne(
        buildSchoolScopedQuery(schoolId, { _id: req.params.id, isActive: true })
      );
      if (!book) return res.status(404).json({ error: req.t('common:routes.bookNotFound') });

      // Auto-generate copy number if not provided
      let copyNumber = data.copyNumber;
      if (!copyNumber) {
        const count = await BookCopy.countDocuments({ schoolId, bookId: req.params.id });
        copyNumber = String(count + 1).padStart(3, '0');
      }

      // Check uniqueness within this book
      const existing = await BookCopy.findOne(
        buildSchoolScopedQuery(schoolId, { bookId: req.params.id, copyNumber })
      );
      if (existing)
        return res
          .status(400)
          .json({ error: req.t('common:routes.copyNumberAlreadyExistsForThisBook') });

      const copy = new BookCopy({
        schoolId,
        bookId: req.params.id,
        copyNumber,
        barcode: data.barcode,
        condition: data.condition || 'good',
        notes: data.notes,
      });

      // Keep book stock in sync
      book.totalCopies += 1;
      book.availableCopies += 1;

      await Promise.all([copy.save(), book.save()]);
      res.status(201).json({ copy });
    } catch (error) {
      if (error.name === 'ZodError') {
        return res
          .status(400)
          .json({ error: req.t('common:routes.validationFailed'), details: error.errors });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/v1/library/copies/:copyId
 * Update condition, barcode, or notes on a copy
 */
router.put(
  '/copies/:copyId',
  authenticate,
  checkPermission('library', 'edit'),
  async (req, res) => {
    try {
      const data = updateCopySchema.parse(req.body);
      const schoolId = req.user.schoolId;

      const copy = await BookCopy.findOne(
        buildSchoolScopedQuery(schoolId, { _id: req.params.copyId, isActive: true })
      );
      if (!copy) return res.status(404).json({ error: req.t('common:routes.copyNotFound') });

      Object.assign(copy, data);
      await copy.save();
      res.json({ copy });
    } catch (error) {
      if (error.name === 'ZodError') {
        return res
          .status(400)
          .json({ error: req.t('common:routes.validationFailed'), details: error.errors });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /api/v1/library/copies/:copyId
 * Decommission a copy (soft delete)
 */
router.delete(
  '/copies/:copyId',
  authenticate,
  checkPermission('library', 'delete'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const copy = await BookCopy.findOne(
        buildSchoolScopedQuery(schoolId, { _id: req.params.copyId, isActive: true })
      );
      if (!copy) return res.status(404).json({ error: req.t('common:routes.copyNotFound') });

      if (copy.status === 'issued') {
        return res
          .status(400)
          .json({ error: req.t('common:routes.cannotDecommissionACopyThatIsCurrentlyIssued') });
      }

      // Keep book stock in sync
      const stockUpdate = { $inc: { totalCopies: -1 } };
      if (copy.status === 'available') stockUpdate.$inc.availableCopies = -1;
      if (copy.status === 'reserved') stockUpdate.$inc.reservedCopies = -1;
      await Book.findByIdAndUpdate(copy.bookId, stockUpdate);

      copy.status = 'decommissioned';
      copy.isActive = false;
      await copy.save();

      res.json({ message: req.t('common:routes.copyDecommissioned') });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
