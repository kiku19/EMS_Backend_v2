import express from 'express';
import { Staff } from '../../database.js';
import { authenticate, requireAdmin as authRequireAdmin } from '../../middleware/auth.js';
import { scopeBySchool } from './helpers.js';
import { validateStaffProfileUpdate } from '../../middleware/validation/staffValidation.js';

const router = express.Router();
router.use(authenticate);

router.put('/:id/credentials', authenticate, authRequireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username && !password) {
      return res.status(400).json({ error: req.t('common:routes.usernameOrPasswordRequired') });
    }

    const updateData = {};
    if (username) {
      // Fix 2.13: Check username uniqueness before update
      const existingUser = await Staff.findOne(
        scopeBySchool(req.user?.schoolId, {
          username,
          _id: { $ne: req.params.id },
          isDeleted: { $ne: true },
        })
      );
      if (existingUser) {
        return res.status(400).json({ error: req.t('common:routes.usernameAlreadyTaken') });
      }
      updateData.username = username;
    }
    if (password) {
      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: req.t('common:routes.passwordMustBeAtLeast8CharactersLong') });
      }
      if (!/[A-Z]/.test(password)) {
        return res
          .status(400)
          .json({ error: req.t('common:routes.passwordMustContainAtLeastOneUppercaseLetter') });
      }
      if (!/[a-z]/.test(password)) {
        return res
          .status(400)
          .json({ error: req.t('common:routes.passwordMustContainAtLeastOneLowercaseLetter') });
      }
      if (!/[0-9]/.test(password)) {
        return res
          .status(400)
          .json({ error: req.t('common:routes.passwordMustContainAtLeastOneNumber') });
      }
      const bcrypt = await import('bcrypt');
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const staff = await Staff.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      updateData,
      { new: true }
    );
    if (!staff) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }

    res.json({ success: true, username: staff.username });
  } catch (error) {
    res.status(500).json({ error: req.t('common:routes.failedToUpdateCredentials') });
  }
});

router.put('/:id/change-password', authenticate, async (req, res) => {
  try {
    if (req.params.id.toString() !== req.user.id.toString()) {
      return res
        .status(403)
        .json({ error: req.t('common:routes.youCanOnlyChangeYourOwnPassword') });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.currentPasswordAndNewPasswordAreRequired') });
    }
    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.passwordMustBeAtLeast8CharactersLong') });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.passwordMustContainAtLeastOneUppercaseLetter') });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.passwordMustContainAtLeastOneLowercaseLetter') });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.passwordMustContainAtLeastOneNumber') });
    }

    const staff = await Staff.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!staff) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }

    const bcrypt = await import('bcrypt');
    const isMatch = await bcrypt.compare(currentPassword, staff.password);
    if (!isMatch) {
      return res.status(400).json({ error: req.t('common:routes.currentPasswordIsIncorrect') });
    }

    staff.password = newPassword;
    staff.markModified('password');
    await staff.save();

    res.json({ success: true, message: req.t('common:routes.passwordChangedSuccessfully') });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: req.t('common:routes.failedToChangePassword') });
  }
});

// Fix 2.2: Self-service profile update should NOT allow admin-only fields like name, designation, department
router.put('/:id/profile', authenticate, validateStaffProfileUpdate, async (req, res) => {
  try {
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: req.t('common:routes.youCanOnlyUpdateYourOwnProfile') });
    }

    // Only allow self-editable fields (not name, designation, department, salary, role)
    const updateData = {
      phone: req.body.phone,
      email: req.body.email?.toLowerCase(),
      address: req.body.address,
      emergencyContact: req.body.emergencyContact,
      emergencyPhone: req.body.emergencyPhone,
      emergencyContacts: req.body.emergencyContacts,
      whatsappNumber: req.body.whatsappNumber,
      isWhatsapp: req.body.isWhatsapp,
      picture: req.body.picture,
      photo: req.body.picture,
      qualification: req.body.qualification,
      experience: req.body.experience,
    };

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    if (updateData.experience !== undefined) {
      updateData.experience = parseInt(updateData.experience, 10) || 0;
    }

    const staff = await Staff.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      updateData,
      { new: true }
    );
    if (!staff) {
      return res.status(404).json({ error: req.t('common:routes.staffNotFound') });
    }

    res.json(staff);
  } catch (error) {
    res.status(500).json({ error: req.t('common:routes.failedToUpdateProfile') });
  }
});

export default router;
