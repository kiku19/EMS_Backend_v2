import mongoose from 'mongoose';

const knowledgeBaseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    content: {
      type: String,
      required: true,
      maxlength: 20000,
    },
    type: {
      type: String,
      enum: ['article', 'faq'],
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: [
        'getting_started',
        'students',
        'staff',
        'fees',
        'attendance',
        'academics',
        'messaging',
        'reports',
        'settings',
        'other',
      ],
      required: true,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    helpfulCount: {
      type: Number,
      default: 0,
    },
    notHelpfulCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

knowledgeBaseSchema.index({ isPublished: 1, category: 1, type: 1, order: 1 });
knowledgeBaseSchema.index({ title: 'text', content: 'text', tags: 'text' });

export default mongoose.model('KnowledgeBase', knowledgeBaseSchema);
