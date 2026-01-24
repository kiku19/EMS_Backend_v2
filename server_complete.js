
    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const student = await Student.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate('classId', 'name section');
    if (!student) return res.status(404).json({ error: 'Student not found' });

    res.json({ id: student._id, ...student.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/students/:id', authenticate, checkPermission('students', 'delete'), async (req, res) => {
  try {
    const result = await Student.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Student not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ START SERVER ============
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
