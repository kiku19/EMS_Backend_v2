import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import BookIssue from '../models/BookIssue.js';
import BookCopy from '../models/BookCopy.js';
import {
  authHeadersFor,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
  createClassRecord,
} from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

vi.mock('../services/trashService.js', () => ({
  logToTrash: vi.fn().mockResolvedValue(undefined),
}));

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function setup() {
  const school = await createSchoolRecord({
    name: `Library School ${nextSeq()}`,
    code: `LS-${nextSeq()}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  const classRecord = await createClassRecord({ schoolId: school._id });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, classRecord, app, headers };
}

function buildBookPayload(overrides = {}) {
  return {
    title: `Book ${nextSeq()}`,
    author: 'Test Author',
    isbn: `ISBN-${nextSeq()}`,
    publisher: 'Test Publisher',
    publishedYear: 2020,
    category: 'textbook',
    subject: 'Math',
    totalCopies: 3,
    rackNumber: 'A1',
    finePerDay: 5,
    ...overrides,
  };
}

function buildIssuePayload(bookId, studentId, overrides = {}) {
  return {
    bookId: bookId.toString(),
    studentId: studentId.toString(),
    dueDate: '2025-12-31',
    notes: 'Test issue',
    ...overrides,
  };
}

function buildReservePayload(bookId, studentId, overrides = {}) {
  return {
    bookId: bookId.toString(),
    studentId: studentId.toString(),
    notes: 'Test reservation',
    ...overrides,
  };
}

async function createBookDirect(schoolId, overrides = {}) {
  return Book.create({
    schoolId,
    title: `Direct Book ${nextSeq()}`,
    author: 'Direct Author',
    totalCopies: 2,
    availableCopies: 2,
    ...overrides,
  });
}

async function createIssueDirect(schoolId, bookId, studentId, overrides = {}) {
  return BookIssue.create({
    schoolId,
    bookId,
    studentId,
    bookTitle: 'Test Book',
    issueDate: new Date(),
    dueDate: new Date('2025-12-31'),
    status: 'issued',
    finePerDay: 5,
    ...overrides,
  });
}

async function createCopyDirect(schoolId, bookId, overrides = {}) {
  return BookCopy.create({
    schoolId,
    bookId,
    copyNumber: `CP${nextSeq()}`,
    status: 'available',
    isActive: true,
    ...overrides,
  });
}

describe('library routes', () => {
  // ─── Auth ──────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 when no auth token is provided', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/library/books').expect(401);
      await request(app).post('/api/library/books').send(buildBookPayload()).expect(401);
      await request(app).get('/api/library/issues').expect(401);
      await request(app).get('/api/library/stats').expect(401);
    });
  });

  // ─── Books ─────────────────────────────────────────────────────────────
  describe('GET /api/library/books', () => {
    it('returns paginated books', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createBookDirect(school._id, { title: 'Book A' });
      await createBookDirect(school._id, { title: 'Book B' });

      const res = await request(app).get('/api/library/books').set(headers).expect(200);

      expect(Array.isArray(res.body.books)).toBe(true);
      expect(res.body.books.length).toBe(2);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
    });

    it('filters books by category', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createBookDirect(school._id, { title: 'Textbook', category: 'textbook' });
      await createBookDirect(school._id, { title: 'Fiction', category: 'fiction' });

      const res = await request(app)
        .get('/api/library/books')
        .query({ category: 'fiction' })
        .set(headers)
        .expect(200);

      expect(res.body.books).toHaveLength(1);
      expect(res.body.books[0].category).toBe('fiction');
    });

    it('searches books by title', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createBookDirect(school._id, { title: 'Alpha Book' });
      await createBookDirect(school._id, { title: 'Beta Book' });

      const res = await request(app)
        .get('/api/library/books')
        .query({ search: 'Alpha' })
        .set(headers)
        .expect(200);

      expect(res.body.books).toHaveLength(1);
      expect(res.body.books[0].title).toBe('Alpha Book');
    });

    it('filters available books', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createBookDirect(school._id, { title: 'Available', availableCopies: 2 });
      await createBookDirect(school._id, { title: 'Unavailable', availableCopies: 0 });

      const res = await request(app)
        .get('/api/library/books')
        .query({ available: 'true' })
        .set(headers)
        .expect(200);

      expect(res.body.books).toHaveLength(1);
      expect(res.body.books[0].title).toBe('Available');
    });
  });

  describe('GET /api/library/books/low-stock', () => {
    it('returns books with low stock', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createBookDirect(school._id, { title: 'Low', availableCopies: 1 });
      await createBookDirect(school._id, { title: 'Normal', availableCopies: 5 });

      const res = await request(app).get('/api/library/books/low-stock').set(headers).expect(200);

      expect(Array.isArray(res.body.books)).toBe(true);
      expect(res.body.books.length).toBe(1);
      expect(res.body.books[0].title).toBe('Low');
    });
  });

  describe('GET /api/library/books/:id', () => {
    it('returns a book by id', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, { title: 'Detail Book' });

      const res = await request(app).get(`/api/library/books/${book._id}`).set(headers).expect(200);

      expect(res.body.book.title).toBe('Detail Book');
    });

    it('returns 404 for non-existent book', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/library/books/${fakeId}`).set(headers).expect(404);
    });
  });

  describe('POST /api/library/books', () => {
    it('creates a new book with auto-generated copies', async () => {
      const { school, app, headers, classRecord } = await setup();
      const payload = buildBookPayload({ totalCopies: 3 });

      const res = await request(app)
        .post('/api/library/books')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.book.title).toBe(payload.title);
      expect(res.body.book.availableCopies).toBe(3);

      const copies = await BookCopy.find({ bookId: res.body.book._id });
      expect(copies.length).toBe(3);
    });

    it('returns 400 for invalid payload', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/library/books')
        .set(headers)
        .send({ title: '' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/library/books/:id', () => {
    it('updates a book', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);

      const res = await request(app)
        .put(`/api/library/books/${book._id}`)
        .set(headers)
        .send({ title: 'Updated Title', author: 'Updated Author' })
        .expect(200);

      expect(res.body.book.title).toBe('Updated Title');
      expect(res.body.book.author).toBe('Updated Author');
    });

    it('creates new copies when totalCopies increases', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, { totalCopies: 2, availableCopies: 2 });
      await createCopyDirect(school._id, book._id, { copyNumber: '001' });
      await createCopyDirect(school._id, book._id, { copyNumber: '002' });

      const res = await request(app)
        .put(`/api/library/books/${book._id}`)
        .set(headers)
        .send({ totalCopies: 4 })
        .expect(200);

      expect(res.body.book.totalCopies).toBe(4);
      const copies = await BookCopy.find({ bookId: book._id });
      expect(copies.length).toBe(4);
    });

    it('returns 404 for non-existent book', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/library/books/${fakeId}`)
        .set(headers)
        .send({ title: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /api/library/books/:id', () => {
    it('soft-deletes a book without active issues', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);

      const res = await request(app)
        .delete(`/api/library/books/${book._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toBeTruthy();
      const deleted = await Book.findById(book._id);
      expect(deleted.isActive).toBe(false);
    });

    it('returns 400 when book has active issues', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createIssueDirect(school._id, book._id, student._id, { status: 'issued' });

      const res = await request(app)
        .delete(`/api/library/books/${book._id}`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });

    it('returns 404 for non-existent book', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/library/books/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Issues ────────────────────────────────────────────────────────────
  describe('GET /api/library/issues', () => {
    it('returns paginated issues', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createIssueDirect(school._id, book._id, student._id);

      const res = await request(app).get('/api/library/issues').set(headers).expect(200);

      expect(Array.isArray(res.body.issues)).toBe(true);
      expect(res.body.issues.length).toBe(1);
      expect(res.body).toHaveProperty('total');
    });

    it('filters issues by status', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const student1 = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        name: 'S1',
      });
      const student2 = await createStudentRecord({
        schoolId: school._id,
        classId: classRecord._id,
        name: 'S2',
      });
      await createIssueDirect(school._id, book._id, student1._id, { status: 'issued' });
      await createIssueDirect(school._id, book._id, student2._id, { status: 'returned' });

      const res = await request(app)
        .get('/api/library/issues')
        .query({ status: 'returned' })
        .set(headers)
        .expect(200);

      expect(res.body.issues).toHaveLength(1);
      expect(res.body.issues[0].status).toBe('returned');
    });

    describe('q search (PAG-12)', () => {
      async function seedSearchData(school, classRecord) {
        const bookA = await createBookDirect(school._id, { title: 'Alpha Adventures' });
        const bookB = await createBookDirect(school._id, { title: 'Beta Reader' });
        const bookC = await createBookDirect(school._id, { title: 'Refund (50%) guide' });
        const student1 = await createStudentRecord({
          schoolId: school._id,
          classId: classRecord._id,
          name: 'Priya Sharma',
        });
        const student2 = await createStudentRecord({
          schoolId: school._id,
          classId: classRecord._id,
          name: 'Arjun Mehta',
        });
        const student3 = await createStudentRecord({
          schoolId: school._id,
          classId: classRecord._id,
          name: 'Refunded Student',
        });
        await createIssueDirect(school._id, bookA._id, student1._id, {
          bookTitle: bookA.title,
          studentName: student1.name,
          studentAdmissionNo: 'ADM-101',
        });
        await createIssueDirect(school._id, bookB._id, student2._id, {
          bookTitle: bookB.title,
          studentName: student2.name,
          studentAdmissionNo: 'ADM-202',
        });
        await createIssueDirect(school._id, bookC._id, student3._id, {
          bookTitle: bookC.title,
          studentName: student3.name,
          studentAdmissionNo: 'ADM-303',
        });
      }

      it('matches on book title', async () => {
        const { school, app, headers, classRecord } = await setup();
        await seedSearchData(school, classRecord);

        const res = await request(app).get('/api/library/issues?q=alpha').set(headers).expect(200);

        expect(res.body.issues).toHaveLength(1);
        expect(res.body.issues[0].bookTitle).toBe('Alpha Adventures');
        expect(res.body.total).toBe(1);
      });

      it('matches on student name', async () => {
        const { school, app, headers, classRecord } = await setup();
        await seedSearchData(school, classRecord);

        const res = await request(app).get('/api/library/issues?q=arjun').set(headers).expect(200);

        expect(res.body.issues).toHaveLength(1);
        expect(res.body.issues[0].studentName).toBe('Arjun Mehta');
      });

      it('matches on admission number', async () => {
        const { school, app, headers, classRecord } = await setup();
        await seedSearchData(school, classRecord);

        const res = await request(app)
          .get('/api/library/issues?q=ADM-202')
          .set(headers)
          .expect(200);

        expect(res.body.issues).toHaveLength(1);
        expect(res.body.issues[0].studentAdmissionNo).toBe('ADM-202');
      });

      it('is case-insensitive', async () => {
        const { school, app, headers, classRecord } = await setup();
        await seedSearchData(school, classRecord);

        const res = await request(app).get('/api/library/issues?q=PRIYA').set(headers).expect(200);

        expect(res.body.issues).toHaveLength(1);
        expect(res.body.issues[0].studentName).toBe('Priya Sharma');
      });

      it('returns an empty list when nothing matches', async () => {
        const { school, app, headers, classRecord } = await setup();
        await seedSearchData(school, classRecord);

        const res = await request(app)
          .get('/api/library/issues?q=nonexistent')
          .set(headers)
          .expect(200);

        expect(res.body.issues).toHaveLength(0);
        expect(res.body.total).toBe(0);
      });

      it('treats regex metacharacters as literal text (no over-match)', async () => {
        const { school, app, headers, classRecord } = await setup();
        await seedSearchData(school, classRecord);

        // '.*' would match everything if not escaped; it must match nothing literal.
        const wildcard = await request(app)
          .get('/api/library/issues?q=.*')
          .set(headers)
          .expect(200);
        expect(wildcard.body.issues).toHaveLength(0);

        // The literal parenthesised text should still be found.
        const literal = await request(app)
          .get('/api/library/issues?q=(50%25)')
          .set(headers)
          .expect(200);
        expect(literal.body.issues).toHaveLength(1);
        expect(literal.body.issues[0].bookTitle).toBe('Refund (50%) guide');
      });

      it('does not crash on object-shaped q (NoSQL injection guard)', async () => {
        const { school, app, headers, classRecord } = await setup();
        await seedSearchData(school, classRecord);

        // q[$ne]= arrives as an object; the route must coerce it to a string
        // rather than passing it into the regex, and must not 500.
        const res = await request(app).get('/api/library/issues?q[$ne]=x').set(headers).expect(200);
        expect(Array.isArray(res.body.issues)).toBe(true);
      });

      it('combines with other filters (status + q)', async () => {
        const { school, app, headers, classRecord } = await setup();
        const book = await createBookDirect(school._id, { title: 'Alpha Book' });
        const s1 = await createStudentRecord({
          schoolId: school._id,
          classId: classRecord._id,
          name: 'A1',
        });
        const s2 = await createStudentRecord({
          schoolId: school._id,
          classId: classRecord._id,
          name: 'A2',
        });
        await createIssueDirect(school._id, book._id, s1._id, {
          bookTitle: 'Alpha Book',
          status: 'issued',
          studentName: 'A1',
        });
        await createIssueDirect(school._id, book._id, s2._id, {
          bookTitle: 'Alpha Book',
          status: 'returned',
          studentName: 'A2',
        });

        const res = await request(app)
          .get('/api/library/issues')
          .query({ q: 'Alpha', status: 'returned' })
          .set(headers)
          .expect(200);

        expect(res.body.issues).toHaveLength(1);
        expect(res.body.issues[0].status).toBe('returned');
      });
    });
  });

  describe('POST /api/library/issues', () => {
    it('issues a book to a student', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, { totalCopies: 2, availableCopies: 2 });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const payload = buildIssuePayload(book._id, student._id);

      const res = await request(app)
        .post('/api/library/issues')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.issue.studentId._id.toString()).toBe(student._id.toString());
      expect(res.body.issue.status).toBe('issued');

      const updatedBook = await Book.findById(book._id);
      expect(updatedBook.availableCopies).toBe(1);
    });

    it('returns 400 when no copies available', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, { totalCopies: 1, availableCopies: 0 });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const payload = buildIssuePayload(book._id, student._id);

      const res = await request(app)
        .post('/api/library/issues')
        .set(headers)
        .send(payload)
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });

    it('returns 400 when student already has the book issued', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, { totalCopies: 2, availableCopies: 2 });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createIssueDirect(school._id, book._id, student._id, { status: 'issued' });

      const payload = buildIssuePayload(book._id, student._id);
      const res = await request(app)
        .post('/api/library/issues')
        .set(headers)
        .send(payload)
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });

    it('returns 404 for non-existent book', async () => {
      const { school, app, headers, classRecord } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const payload = buildIssuePayload(fakeId, student._id);

      await request(app).post('/api/library/issues').set(headers).send(payload).expect(404);
    });
  });

  describe('PUT /api/library/issues/:id/return', () => {
    it('returns a book and calculates fine', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, {
        totalCopies: 1,
        availableCopies: 0,
        finePerDay: 10,
      });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const issue = await createIssueDirect(school._id, book._id, student._id, {
        status: 'issued',
        dueDate: new Date('2020-01-01'), // past due
        finePerDay: 10,
      });

      const res = await request(app)
        .put(`/api/library/issues/${issue._id}/return`)
        .set(headers)
        .send({ finePaid: true, returnCondition: 'good' })
        .expect(200);

      expect(res.body.issue.status).toBe('returned');
      expect(res.body.fineAmount).toBeGreaterThan(0);

      const updatedBook = await Book.findById(book._id);
      expect(updatedBook.availableCopies).toBe(1);
    });

    it('returns 404 for non-existent issue', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/library/issues/${fakeId}/return`)
        .set(headers)
        .send({})
        .expect(404);
    });
  });

  describe('POST /api/library/issues/reserve', () => {
    it('reserves a book for a student', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const payload = buildReservePayload(book._id, student._id);

      const res = await request(app)
        .post('/api/library/issues/reserve')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.reservation.status).toBe('reserved');
    });

    it('returns 400 when student already has a reservation', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createIssueDirect(school._id, book._id, student._id, { status: 'reserved' });

      const payload = buildReservePayload(book._id, student._id);
      const res = await request(app)
        .post('/api/library/issues/reserve')
        .set(headers)
        .send(payload)
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/library/issues/:id/cancel', () => {
    it('cancels a reservation', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, { reservedCopies: 1 });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      const issue = await createIssueDirect(school._id, book._id, student._id, {
        status: 'reserved',
      });

      const res = await request(app)
        .put(`/api/library/issues/${issue._id}/cancel`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toBeTruthy();
    });

    it('returns 404 for non-existent reservation', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).put(`/api/library/issues/${fakeId}/cancel`).set(headers).expect(404);
    });
  });

  // ─── Student History ───────────────────────────────────────────────────
  describe('GET /api/library/students/:studentId/history', () => {
    it('returns reading history for a student', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createIssueDirect(school._id, book._id, student._id);

      const res = await request(app)
        .get(`/api/library/students/${student._id}/history`)
        .set(headers)
        .expect(200);

      expect(Array.isArray(res.body.issues)).toBe(true);
      expect(res.body.issues.length).toBe(1);
    });
  });

  // ─── Overdue Sync ──────────────────────────────────────────────────────
  describe('POST /api/library/sync-overdue', () => {
    it('marks past-due issues as overdue', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createIssueDirect(school._id, book._id, student._id, {
        status: 'issued',
        dueDate: new Date('2020-01-01'),
      });

      const res = await request(app).post('/api/library/sync-overdue').set(headers).expect(200);

      expect(res.body).toHaveProperty('updated');
      expect(typeof res.body.updated).toBe('number');
    });
  });

  // ─── Stats ─────────────────────────────────────────────────────────────
  describe('GET /api/library/stats', () => {
    it('returns library statistics', async () => {
      const { school, app, headers, classRecord } = await setup();
      await createBookDirect(school._id, {
        title: 'Stats Book',
        totalCopies: 5,
        availableCopies: 3,
      });

      const res = await request(app).get('/api/library/stats').set(headers).expect(200);

      expect(res.body).toHaveProperty('totalBooks');
      expect(res.body).toHaveProperty('totalCopies');
      expect(res.body).toHaveProperty('availableCopies');
      expect(res.body).toHaveProperty('issued');
      expect(res.body).toHaveProperty('overdue');
      expect(res.body).toHaveProperty('reserved');
      expect(res.body.totalBooks).toBe(1);
    });
  });

  // ─── Reports ───────────────────────────────────────────────────────────
  describe('GET /api/library/reports', () => {
    it('returns library reports', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, {
        title: 'Report Book',
        category: 'textbook',
      });
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createIssueDirect(school._id, book._id, student._id);

      const res = await request(app).get('/api/library/reports').set(headers).expect(200);

      expect(res.body).toHaveProperty('mostBorrowed');
      expect(res.body).toHaveProperty('categoryStats');
      expect(res.body).toHaveProperty('overdueByStudent');
      expect(res.body).toHaveProperty('unpaidFines');
    });
  });

  // ─── Library Card ──────────────────────────────────────────────────────
  describe('GET /api/library/students/:studentId/card', () => {
    it('returns library card data', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const student = await createStudentRecord({ schoolId: school._id, classId: classRecord._id });
      await createIssueDirect(school._id, book._id, student._id, { status: 'issued' });

      const res = await request(app)
        .get(`/api/library/students/${student._id}/card`)
        .set(headers)
        .expect(200);

      expect(res.body).toHaveProperty('studentId');
      expect(res.body).toHaveProperty('activeIssues');
      expect(res.body).toHaveProperty('totalBorrowed');
    });
  });

  // ─── Book Copies ───────────────────────────────────────────────────────
  describe('GET /api/library/books/:id/copies', () => {
    it('returns copies for a book', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      await createCopyDirect(school._id, book._id, { copyNumber: '001' });
      await createCopyDirect(school._id, book._id, { copyNumber: '002' });

      const res = await request(app)
        .get(`/api/library/books/${book._id}/copies`)
        .set(headers)
        .expect(200);

      expect(Array.isArray(res.body.copies)).toBe(true);
      expect(res.body.copies.length).toBe(2);
    });
  });

  describe('POST /api/library/books/:id/copies', () => {
    it('adds a copy to a book', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, { totalCopies: 2, availableCopies: 2 });

      const res = await request(app)
        .post(`/api/library/books/${book._id}/copies`)
        .set(headers)
        .send({ copyNumber: '003', condition: 'new' })
        .expect(201);

      expect(res.body.copy.copyNumber).toBe('003');

      const updatedBook = await Book.findById(book._id);
      expect(updatedBook.totalCopies).toBe(3);
      expect(updatedBook.availableCopies).toBe(3);
    });

    it('returns 404 for non-existent book', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .post(`/api/library/books/${fakeId}/copies`)
        .set(headers)
        .send({})
        .expect(404);
    });
  });

  describe('PUT /api/library/copies/:copyId', () => {
    it('updates a copy', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const copy = await createCopyDirect(school._id, book._id);

      const res = await request(app)
        .put(`/api/library/copies/${copy._id}`)
        .set(headers)
        .send({ condition: 'damaged', notes: 'Damaged copy' })
        .expect(200);

      expect(res.body.copy.condition).toBe('damaged');
      expect(res.body.copy.notes).toBe('Damaged copy');
    });

    it('returns 404 for non-existent copy', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/library/copies/${fakeId}`)
        .set(headers)
        .send({ condition: 'good' })
        .expect(404);
    });
  });

  describe('DELETE /api/library/copies/:copyId', () => {
    it('decommissions a copy', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id, { totalCopies: 2, availableCopies: 2 });
      const copy = await createCopyDirect(school._id, book._id, { status: 'available' });

      const res = await request(app)
        .delete(`/api/library/copies/${copy._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.message).toBeTruthy();
      const deleted = await BookCopy.findById(copy._id);
      expect(deleted.isActive).toBe(false);
      expect(deleted.status).toBe('decommissioned');
    });

    it('returns 400 when copy is currently issued', async () => {
      const { school, app, headers, classRecord } = await setup();
      const book = await createBookDirect(school._id);
      const copy = await createCopyDirect(school._id, book._id, { status: 'issued' });

      const res = await request(app)
        .delete(`/api/library/copies/${copy._id}`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });

    it('returns 404 for non-existent copy', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/library/copies/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Multi-tenancy ─────────────────────────────────────────────────────
  describe('Multi-tenancy', () => {
    it('School A admin cannot see School B books', async () => {
      const schoolA = await createSchoolRecord({ name: 'Tenant A' });
      const schoolB = await createSchoolRecord({ name: 'Tenant B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      await createBookDirect(schoolA._id, { title: 'Book A' });
      await createBookDirect(schoolB._id, { title: 'Book B' });

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      const res = await request(app).get('/api/library/books').set(headersA).expect(200);
      const titles = res.body.books.map((b) => b.title);
      expect(titles).toContain('Book A');
      expect(titles).not.toContain('Book B');
    });

    it('School A admin cannot access School B book by ID', async () => {
      const schoolA = await createSchoolRecord({ name: 'ISO A' });
      const schoolB = await createSchoolRecord({ name: 'ISO B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const bookB = await createBookDirect(schoolB._id);

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      await request(app).get(`/api/library/books/${bookB._id}`).set(headersA).expect(404);
    });
  });
});
