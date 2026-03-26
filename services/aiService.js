import crypto from 'crypto';
import { extractSchoolId } from '../utils/schoolContext.js';
import FeeHead from '../models/FeeHead.js';
import { PERMISSION_TEMPLATES } from '../models/UserPermission.js';
import {
  Class,
  FormAssignment,
  IntakeForm,
  Staff,
  Student,
  StudentFeeStructure,
  UserPermission,
  getNextAdmissionId,
  getNextRollNumber,
} from '../database.js';
import {
  buildPermissionsArray,
  determineRole,
  ensurePermissionDocument,
} from '../middleware/permissions.js';
import { createOrUpdateParentAccount } from '../utils/parentAccountHelper.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import {
  MAX_AI_HISTORY_MESSAGES,
  MAX_AI_TOOL_ROUNDS,
  assessSchoolScope,
  buildAiSystemPrompt,
  getDefaultAiModelId,
  getPublicAiModels,
  resolveAiModel,
} from '../config/ai.js';

const STAFF_SAFE_FIELDS = [
  '_id',
  'code',
  'name',
  'role',
  'department',
  'status',
  'phone',
  'email',
  'joinDate',
  'designation',
  'shift',
  'assignedClasses',
  'isClassTeacher',
  'classTeacherOf',
  'professionalQualifications',
  'totalExperience',
  'qualification',
  'teacherAssignments',
].join(' ');

const TOOL_DEFINITIONS = [
  {
    name: 'create_student',
    description:
      'Create a new student in the school system when the user explicitly asks to add a student.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name of the student' },
        classId: { type: 'string', description: 'MongoDB ObjectId for the class' },
        rollNo: { type: 'number', description: 'Roll number if already known' },
        gender: { type: 'string', enum: ['Male', 'Female', 'Other'] },
        dateOfBirth: { type: 'string', description: 'YYYY-MM-DD' },
        parentName: { type: 'string' },
        parentPhone: { type: 'string' },
        parentEmail: { type: 'string' },
        academicYear: { type: 'string', description: 'Academic year in YYYY-YY format' },
      },
      required: ['name', 'classId', 'parentName', 'parentPhone'],
    },
  },
  {
    name: 'send_form',
    description: 'Assign an intake form to an existing staff member or student by ID.',
    parameters: {
      type: 'object',
      properties: {
        formId: { type: 'string' },
        recipientId: { type: 'string' },
        recipientType: { type: 'string', enum: ['staff', 'student'] },
        dueDate: { type: 'string', description: 'Optional due or expiration date in ISO format' },
        notes: { type: 'string' },
      },
      required: ['formId', 'recipientId', 'recipientType'],
    },
  },
  {
    name: 'get_classes',
    description: 'Get the list of school classes.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_forms',
    description: 'Get the list of intake forms available in the school system.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_staff',
    description: 'Search staff members by name, role, or department.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        role: { type: 'string' },
        department: { type: 'string' },
      },
    },
  },
  {
    name: 'get_staff_details',
    description: 'Get non-sensitive staff profile details for a specific staff member by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_students',
    description: 'Search students by class ID, student name, or parent name.',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'get_student_details',
    description: 'Get student profile details for a specific student by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
];

class AiRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AiRequestError';
    this.status = status;
  }
}

function getResolvedModel(modelId) {
  try {
    return resolveAiModel(modelId);
  } catch (error) {
    throw new AiRequestError('AI service is not configured on the backend.', 503);
  }
}

function sanitizeMessageContent(content) {
  return String(content || '')
    .trim()
    .slice(0, 4000);
}

function normalizeMessages(messages = []) {
  return messages
    .filter(
      (message) =>
        ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string'
    )
    .map((message) => ({
      role: message.role,
      content: sanitizeMessageContent(message.content),
    }))
    .filter((message) => message.content)
    .slice(-MAX_AI_HISTORY_MESSAGES);
}

function safeJsonParse(value, fallback = {}) {
  if (!value || typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildRegex(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function generateAccessToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function getOrCreatePermissions(userId) {
  let userPermission = await UserPermission.findOne({ userId });

  if (!userPermission) {
    const user = await Staff.findById(userId).select('role');

    if (!user) {
      throw new AiRequestError('Authenticated staff member was not found.', 404);
    }

    const role = determineRole(user.role);
    const defaultPermissions = PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.teacher;

    userPermission = await UserPermission.findOneAndUpdate(
      { userId },
      {
        userId,
        role,
        permissions: buildPermissionsArray(defaultPermissions),
        customPermissions: false,
      },
      { upsert: true, new: true }
    );
  } else {
    await ensurePermissionDocument(userPermission, userPermission.role);
  }

  return userPermission;
}

async function requirePermission(userId, moduleName, action) {
  const permissionDoc = await getOrCreatePermissions(userId);
  const modulePermission = permissionDoc.permissions.find(
    (permission) => permission.module === moduleName
  );

  if (!modulePermission || !modulePermission[action]) {
    throw new AiRequestError(`You do not have permission to ${action} ${moduleName}.`, 403);
  }
}

async function initializeFeeStructure(student) {
  const academicYear = student.academicYear || CURRENT_ACADEMIC_YEAR;
  const existingFeeStructure = await StudentFeeStructure.findOne({
    studentId: student._id,
    academicYear,
  });

  if (existingFeeStructure) {
    return;
  }

  const classInfo = await Class.findById(student.classId);
  if (!classInfo) {
    return;
  }

  const classNumber = classInfo.name.replace('Class ', '');
  const applicableFeeHeads = await FeeHead.find({
    schoolId: student.schoolId,
    applicableClasses: classNumber,
    academicYear,
    isActive: true,
  });

  const feeStructure = new StudentFeeStructure({
    studentId: student._id,
    classId: student.classId,
    academicYear,
    feeHeads: applicableFeeHeads.map((feeHead) => ({
      feeHeadId: feeHead._id,
      name: feeHead.name,
      category: feeHead.category,
      amount: feeHead.amount,
      mandatory: feeHead.mandatory,
      frequency: feeHead.frequency,
      paidAmount: 0,
      balanceAmount: feeHead.amount,
      status: 'pending',
    })),
  });

  feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, feeHead) => sum + feeHead.amount, 0);
  feeStructure.totalPaid = 0;
  feeStructure.totalBalance = feeStructure.totalFee;
  feeStructure.overallStatus = 'pending';

  await feeStructure.save();
}

async function createStudentTool(args, context) {
  await requirePermission(context.userId, 'students', 'create');

  if (!args.name || !args.classId || !args.parentName || !args.parentPhone) {
    throw new AiRequestError(
      'name, classId, parentName, and parentPhone are required to create a student.'
    );
  }

  const classDoc = await Class.findById(args.classId);
  if (!classDoc) {
    throw new AiRequestError('The selected class was not found.');
  }

  const academicYear = args.academicYear || CURRENT_ACADEMIC_YEAR;
  const admissionId = args.admissionId || (await getNextAdmissionId(context.schoolId));
  const rollNo = args.rollNo || (await getNextRollNumber(args.classId, context.schoolId));
  const parents = [
    {
      name: args.parentName,
      relationship: args.parentRelationship || 'Guardian',
      phone: args.parentPhone,
      email: args.parentEmail || '',
      occupation: args.parentOccupation || '',
      isWhatsapp: true,
    },
  ];

  const student = new Student({
    name: args.name,
    admissionId,
    academicYear,
    rollNo,
    classId: args.classId,
    schoolId: context.schoolId,
    gender: args.gender || '',
    dateOfBirth: args.dateOfBirth || '',
    parentName: args.parentName,
    parentPhone: args.parentPhone,
    parentEmail: args.parentEmail || '',
    parentRelationship: args.parentRelationship || 'Guardian',
    parentOccupation: args.parentOccupation || '',
    parents,
    feeStatus: 'pending',
    status: 'active',
  });

  await student.save();

  try {
    await createOrUpdateParentAccount(student);
  } catch (error) {
    console.error('Failed to create or update parent account from AI flow:', error);
  }

  try {
    await initializeFeeStructure(student);
  } catch (error) {
    console.error('Failed to initialize fee structure from AI flow:', error);
  }

  return {
    success: true,
    student: {
      id: student._id,
      name: student.name,
      admissionId: student.admissionId,
      classId: student.classId,
      className: `${classDoc.name} ${classDoc.section}`,
      rollNo: student.rollNo,
      academicYear: student.academicYear,
    },
    message: `Student ${student.name} was created successfully.`,
  };
}

async function sendFormTool(args, context) {
  const form = await IntakeForm.findById(args.formId).select('formName formType status');
  if (!form) {
    throw new AiRequestError('The selected form was not found.');
  }

  const recipientType = String(args.recipientType || '').toLowerCase();
  if (!['staff', 'student'].includes(recipientType)) {
    throw new AiRequestError('recipientType must be either "staff" or "student".');
  }

  let recipient;
  if (recipientType === 'staff') {
    recipient = await Staff.findById(args.recipientId).select('name email phone');
  } else {
    recipient = await Student.findById(args.recipientId).select('name parentEmail parentPhone');
  }

  if (!recipient) {
    throw new AiRequestError(`The ${recipientType} recipient was not found.`);
  }

  const assignedToEmail = recipientType === 'staff' ? recipient.email : recipient.parentEmail;
  const assignedToPhone = recipientType === 'staff' ? recipient.phone : recipient.parentPhone;

  if (!assignedToEmail && !assignedToPhone) {
    throw new AiRequestError(
      `The selected ${recipientType} does not have an email address or phone number on file.`
    );
  }

  const parsedDueDate = args.dueDate ? new Date(args.dueDate) : null;
  const expiresAt =
    parsedDueDate && !Number.isNaN(parsedDueDate.getTime())
      ? parsedDueDate
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const assignment = await FormAssignment.create({
    formId: form._id,
    assignedToEmail: assignedToEmail || undefined,
    assignedToPhone: assignedToPhone || undefined,
    assignedBy: context.userId,
    status: 'pending',
    accessToken: generateAccessToken(),
    expiresAt,
    assignedAt: new Date(),
  });

  return {
    success: true,
    assignment: {
      id: assignment._id,
      formId: form._id,
      formName: form.formName,
      recipientId: args.recipientId,
      recipientName: recipient.name,
      recipientType,
      assignedToEmail: assignedToEmail || null,
      assignedToPhone: assignedToPhone || null,
      expiresAt: assignment.expiresAt,
    },
    message: `${form.formName} was assigned to ${recipient.name}.`,
  };
}

async function getClassesTool(_args, context) {
  await requirePermission(context.userId, 'classes', 'view');

  const classQuery = context.schoolId ? { schoolId: context.schoolId } : {};
  const classes = await Class.find(classQuery)
    .populate('classTeacherId', 'name')
    .sort({ name: 1, section: 1 })
    .lean();

  return {
    success: true,
    classes: classes.map((classDoc) => ({
      id: classDoc._id,
      name: classDoc.name,
      section: classDoc.section,
      displayName: `${classDoc.name} ${classDoc.section}`,
      academicYear: classDoc.academicYear,
      classTeacherName: classDoc.classTeacherId?.name || null,
    })),
    count: classes.length,
  };
}

async function getFormsTool(_args, context) {
  const formQuery = context.schoolId ? { schoolId: context.schoolId } : {};
  const forms = await IntakeForm.find(formQuery).sort({ createdAt: -1 }).lean();

  return {
    success: true,
    forms: forms.map((form) => ({
      id: form._id,
      formName: form.formName,
      formType: form.formType,
      status: form.status,
      fieldCount: Array.isArray(form.fields) ? form.fields.length : 0,
    })),
    count: forms.length,
  };
}

async function getStaffTool(args, context) {
  await requirePermission(context.userId, 'staff', 'view');

  const query = {};
  if (context.schoolId) {
    query.schoolId = context.schoolId;
  }
  if (args.name) {
    query.name = buildRegex(args.name);
  }
  if (args.role) {
    query.role = buildRegex(args.role);
  }
  if (args.department) {
    query.department = buildRegex(args.department);
  }

  const staffMembers = await Staff.find(query)
    .select(STAFF_SAFE_FIELDS)
    .sort({ name: 1 })
    .limit(25)
    .lean();

  return {
    success: true,
    staff: staffMembers.map((staff) => ({
      id: staff._id,
      code: staff.code,
      name: staff.name,
      role: Array.isArray(staff.role) ? staff.role : [staff.role].filter(Boolean),
      department: staff.department || '',
      status: staff.status || '',
      phone: staff.phone || '',
      email: staff.email || '',
      designation: staff.designation || '',
      classTeacherOf: staff.classTeacherOf || '',
    })),
    count: staffMembers.length,
  };
}

async function getStaffDetailsTool(args, context) {
  await requirePermission(context.userId, 'staff', 'view');

  const staffQuery = context.schoolId
    ? { _id: args.id, schoolId: context.schoolId }
    : { _id: args.id };
  const staff = await Staff.findOne(staffQuery).select(STAFF_SAFE_FIELDS).lean();

  if (!staff) {
    throw new AiRequestError('Staff member not found.', 404);
  }

  return {
    success: true,
    staff: {
      id: staff._id,
      code: staff.code,
      name: staff.name,
      role: Array.isArray(staff.role) ? staff.role : [staff.role].filter(Boolean),
      department: staff.department || '',
      status: staff.status || '',
      phone: staff.phone || '',
      email: staff.email || '',
      joinDate: staff.joinDate || '',
      designation: staff.designation || '',
      shift: staff.shift || '',
      assignedClasses: staff.assignedClasses || [],
      isClassTeacher: Boolean(staff.isClassTeacher),
      classTeacherOf: staff.classTeacherOf || '',
      qualifications: staff.professionalQualifications || [],
      totalExperience: staff.totalExperience || '',
      qualificationSummary: staff.qualification || '',
    },
  };
}

async function getStudentsTool(args, context) {
  await requirePermission(context.userId, 'students', 'view');

  const query = { isDeleted: { $ne: true } };
  if (context.schoolId) {
    query.schoolId = context.schoolId;
  }
  if (args.classId) {
    query.classId = args.classId;
  }
  if (args.name) {
    const regex = buildRegex(args.name);
    query.$or = [{ name: regex }, { parentName: regex }];
  }

  const students = await Student.find(query)
    .populate('classId', 'name section')
    .sort({ name: 1 })
    .limit(25)
    .lean();

  return {
    success: true,
    students: students.map((student) => ({
      id: student._id,
      name: student.name,
      admissionId: student.admissionId,
      rollNo: student.rollNo,
      className: student.classId ? `${student.classId.name} ${student.classId.section}` : '',
      parentName: student.parentName || '',
      parentPhone: student.parentPhone || '',
      status: student.status || '',
      feeStatus: student.feeStatus || '',
    })),
    count: students.length,
  };
}

async function getStudentDetailsTool(args, context) {
  await requirePermission(context.userId, 'students', 'view');

  const studentQuery = context.schoolId
    ? { _id: args.id, schoolId: context.schoolId }
    : { _id: args.id };
  const student = await Student.findOne(studentQuery).populate('classId', 'name section').lean();

  if (!student) {
    throw new AiRequestError('Student not found.', 404);
  }

  return {
    success: true,
    student: {
      id: student._id,
      name: student.name,
      admissionId: student.admissionId,
      academicYear: student.academicYear,
      rollNo: student.rollNo,
      className: student.classId ? `${student.classId.name} ${student.classId.section}` : '',
      gender: student.gender || '',
      dateOfBirth: student.dateOfBirth || '',
      parentName: student.parentName || '',
      parentPhone: student.parentPhone || '',
      parentEmail: student.parentEmail || '',
      address: student.address || '',
      previousSchool: student.previousSchool || '',
      transportRequired: Boolean(student.transportRequired),
      hostelRequired: Boolean(student.hostelRequired),
      feeStatus: student.feeStatus || '',
      status: student.status || '',
    },
  };
}

const TOOL_EXECUTORS = {
  create_student: createStudentTool,
  send_form: sendFormTool,
  get_classes: getClassesTool,
  get_forms: getFormsTool,
  get_staff: getStaffTool,
  get_staff_details: getStaffDetailsTool,
  get_students: getStudentsTool,
  get_student_details: getStudentDetailsTool,
};

async function executeTool(name, args, context) {
  const executor = TOOL_EXECUTORS[name];

  if (!executor) {
    throw new AiRequestError(`Unsupported tool: ${name}`);
  }

  try {
    return await executor(args, context);
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Tool execution failed',
    };
  }
}

async function callGroq(messages, model, context) {
  const requestMessages = [
    {
      role: 'system',
      content: buildAiSystemPrompt(context.schoolName),
    },
    ...messages,
  ];
  const toolCalls = [];

  for (let round = 0; round < MAX_AI_TOOL_ROUNDS; round += 1) {
    const response = await fetch(model.chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.chatModel,
        messages: requestMessages,
        tools: TOOL_DEFINITIONS.map((tool) => ({
          type: 'function',
          function: tool,
        })),
        tool_choice: 'auto',
        temperature: 0.2,
        max_completion_tokens: 1024,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AiRequestError(
        data.error?.message || 'Failed to fetch response from Groq.',
        response.status
      );
    }

    const assistantMessage = data.choices?.[0]?.message;
    if (!assistantMessage) {
      throw new AiRequestError('Groq returned an empty response.', 502);
    }

    if (!assistantMessage.tool_calls?.length) {
      const lastTool = toolCalls[toolCalls.length - 1] || null;
      return {
        content: assistantMessage.content || 'I could not generate a response.',
        functionCalled: lastTool?.name || null,
        functionArgs: lastTool?.args || null,
        functionResult: lastTool?.result || null,
        toolCalls,
      };
    }

    requestMessages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      const args = safeJsonParse(toolCall.function?.arguments, {});
      const result = await executeTool(toolCall.function?.name, args, context);

      toolCalls.push({
        name: toolCall.function?.name || 'unknown_tool',
        args,
        result,
      });

      requestMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function?.name,
        content: JSON.stringify(result),
      });
    }
  }

  throw new AiRequestError('The assistant reached its tool-call limit for this request.', 502);
}

function toGeminiContents(messages) {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
}

async function callGemini(messages, model, context) {
  const contents = toGeminiContents(messages);
  const toolCalls = [];

  for (let round = 0; round < MAX_AI_TOOL_ROUNDS; round += 1) {
    const response = await fetch(model.chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': model.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildAiSystemPrompt(context.schoolName) }],
        },
        contents,
        tools: [
          {
            functionDeclarations: TOOL_DEFINITIONS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AiRequestError(
        data.error?.message || 'Failed to fetch response from Gemini.',
        response.status
      );
    }

    const candidate = data.candidates?.[0]?.content;
    const parts = candidate?.parts || [];
    const functionCallPart = parts.find((part) => part.functionCall);
    const textContent = parts
      .filter((part) => typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();

    if (!functionCallPart) {
      const lastTool = toolCalls[toolCalls.length - 1] || null;
      return {
        content: textContent || 'I could not generate a response.',
        functionCalled: lastTool?.name || null,
        functionArgs: lastTool?.args || null,
        functionResult: lastTool?.result || null,
        toolCalls,
      };
    }

    const functionName = functionCallPart.functionCall?.name;
    const args = functionCallPart.functionCall?.args || {};
    const result = await executeTool(functionName, args, context);

    toolCalls.push({
      name: functionName,
      args,
      result,
    });

    contents.push(candidate);
    contents.push({
      role: 'tool',
      parts: [
        {
          functionResponse: {
            name: functionName,
            response: result,
          },
        },
      ],
    });
  }

  throw new AiRequestError('The assistant reached its tool-call limit for this request.', 502);
}

export async function processAiChat({ messages, selectedModel, user }) {
  const normalizedMessages = normalizeMessages(messages);

  if (normalizedMessages.length === 0) {
    throw new AiRequestError('At least one user message is required.');
  }

  const scope = assessSchoolScope(normalizedMessages);
  if (!scope.allowed) {
    return {
      content: scope.reason,
      functionCalled: null,
      functionArgs: null,
      functionResult: null,
      toolCalls: [],
    };
  }

  const model = getResolvedModel(selectedModel || getDefaultAiModelId());
  const context = {
    userId: user.userId || user.id,
    schoolId: user.schoolId ? extractSchoolId(user.schoolId) : undefined,
    schoolName: process.env.SCHOOL_NAME || 'the school',
  };

  if (model.id === 'gemini') {
    return callGemini(normalizedMessages, model, context);
  }

  return callGroq(normalizedMessages, model, context);
}

export async function transcribeAiAudio(file) {
  if (!file?.buffer) {
    throw new AiRequestError('No audio file was provided.');
  }

  const transcriptionModel = Object.values(getPublicAiModels()).find(
    (model) => model.available && model.id === 'groq'
  );
  const resolvedModel = getResolvedModel(transcriptionModel?.id || getDefaultAiModelId());

  if (!resolvedModel.supportsTranscription) {
    throw new AiRequestError('Audio transcription is not configured on the backend.', 503);
  }

  const formData = new FormData();
  const audioBlob = new Blob([file.buffer], { type: file.mimetype || 'audio/webm' });
  formData.append('file', audioBlob, file.originalname || 'audio.webm');
  formData.append('model', resolvedModel.transcriptionModel);
  formData.append('language', 'en');
  formData.append('response_format', 'json');

  const response = await fetch(resolvedModel.transcriptionEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolvedModel.apiKey}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AiRequestError(data.error?.message || 'Failed to transcribe audio.', response.status);
  }

  return {
    text: data.text || '',
  };
}

export function getAiModelsPayload() {
  return {
    defaultModelId: getDefaultAiModelId(),
    models: getPublicAiModels(),
  };
}

export { AiRequestError };
