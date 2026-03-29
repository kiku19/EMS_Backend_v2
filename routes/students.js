/**
 * @swagger
 * tags:
 *   name: Students
 *   description: Student CRUD & profile management
 */

/**
 * @swagger
 * /students:
 *   get:
 *     summary: List students
 *     description: Returns a paginated, filtered list of students scoped to the authenticated school.
 *     tags: [Students]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *       - $ref: '#/components/parameters/SearchQuery'
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/LimitQuery'
 *       - in: query
 *         name: classId
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *         description: Filter by class
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, transferred, alumni, all]
 *         description: Filter by student status
 *       - in: query
 *         name: feeStatus
 *         schema:
 *           type: string
 *           enum: [paid, partial, pending, overdue, all]
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [name, rollNo, class]
 *           default: name
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *     responses:
 *       200:
 *         description: Paginated student list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 students:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StudentBase'
 *                 total:   { type: integer }
 *                 page:    { type: integer }
 *                 limit:   { type: integer }
 *                 hasMore: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: Create a student
 *     tags: [Students]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateStudentRequest'
 *     responses:
 *       201:
 *         description: Student created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StudentBase'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: Admission ID already exists in this school
 */

/**
 * @swagger
 * /students/{id}:
 *   get:
 *     summary: Get a student by ID
 *     tags: [Students]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Student profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StudentBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Update a student
 *     tags: [Students]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateStudentRequest'
 *     responses:
 *       200:
 *         description: Updated student
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StudentBase'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Soft-delete a student
 *     tags: [Students]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /students/{id}/remarks:
 *   get:
 *     summary: List remarks for a student
 *     tags: [Students, Remarks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: List of remarks
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: Add a remark for a student
 *     tags: [Students, Remarks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, minLength: 1 }
 *               sentToParent: { type: boolean, default: false }
 *               category: { type: string }
 *     responses:
 *       201:
 *         description: Remark created
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /students/{id}/remarks/{remarkId}:
 *   put:
 *     summary: Update a remark
 *     tags: [Students, Remarks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *       - in: path
 *         name: remarkId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description]
 *             properties:
 *               title: { type: string, minLength: 1, maxLength: 200 }
 *               description: { type: string, minLength: 1, maxLength: 2000 }
 *               category: { type: string }
 *               sentToParent: { type: boolean }
 *     responses:
 *       200:
 *         description: Remark updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Soft-delete a remark
 *     tags: [Students, Remarks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *       - in: path
 *         name: remarkId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Remark deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /students/{id}/remarks/{remarkId}/resend:
 *   post:
 *     summary: Resend a remark notification to parent
 *     tags: [Students, Remarks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *       - in: path
 *         name: remarkId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Remark resent to parent
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /students/{id}/documents:
 *   post:
 *     summary: Attach a document to a student profile
 *     tags: [Students]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type]
 *             properties:
 *               name: { type: string }
 *               type: { type: string }
 *               url:  { type: string, format: uri }
 *               front:
 *                 type: object
 *                 properties:
 *                   url: { type: string, format: uri }
 *               back:
 *                 type: object
 *                 properties:
 *                   url: { type: string, format: uri }
 *               category: { type: string }
 *     responses:
 *       200:
 *         description: Document added
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

export { default } from './students/index.js';
