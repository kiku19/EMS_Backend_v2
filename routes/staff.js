/**
 * @swagger
 * tags:
 *   name: Staff
 *   description: Staff members & roles
 */

/**
 * @swagger
 * /staff:
 *   get:
 *     summary: List staff members
 *     tags: [Staff]
 *     parameters:
 *       - $ref: '#/components/parameters/SearchQuery'
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/LimitQuery'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, on-leave, all]
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *         description: Filter by role (e.g. teacher, admin)
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated staff list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 staff:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StaffBase'
 *                 total: { type: integer }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: Create a staff member
 *     tags: [Staff]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateStaffRequest'
 *     responses:
 *       201:
 *         description: Staff member created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffBase'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: Staff with same phone/email already exists
 */

/**
 * @swagger
 * /staff/{id}:
 *   get:
 *     summary: Get a staff member by ID
 *     tags: [Staff]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Staff profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Update a staff member
 *     tags: [Staff]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateStaffRequest'
 *     responses:
 *       200:
 *         description: Updated staff member
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Soft-delete a staff member
 *     tags: [Staff]
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
 * /staff/{id}/reset-password:
 *   post:
 *     summary: Reset staff member password (admin only)
 *     tags: [Staff]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

import express from 'express';
import miscRouter from './staff/misc.js';
import timetableRouter from './staff/timetable.js';
import authRouter from './staff/auth.js';
import coreRouter from './staff/core.js';

const router = express.Router();

// Order matters: specific paths (/public, /me, /validate/:id) must be mounted before generic /:id
router.use('/', miscRouter);
router.use('/', timetableRouter);
router.use('/', authRouter);
router.use('/', coreRouter);

export default router;
