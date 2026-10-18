const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ==========================================
// เชื่อมต่อ MySQL
// ==========================================

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'remotionrehab_db'
});

db.connect((err) => {
  if (err) {
    console.error('เชื่อมต่อ MySQL ไม่สำเร็จ:', err);
    return;
  }
  console.log('เชื่อมต่อฐานข้อมูล MySQL สำเร็จแล้ว!');
});

// ==========================================
// 0. API สำหรับเข้าสู่ระบบของคนไข้ (Patient Login) [เพิ่มเข้ามาใหม่]
// ==========================================
app.post('/api/patient/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรศัพท์และรหัสผ่านให้ครบถ้วน' });
  }

  // ค้นหาข้อมูลคนไข้จากเบอร์โทรศัพท์ในตาราง patient
  const query = 'SELECT * FROM patient WHERE Phone = ?';

  db.query(query, [phone], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: 'ไม่พบเบอร์โทรศัพท์นี้ในระบบ' });
    }

    const patient = results[0];

    // ตรวจสอบรหัสผ่าน (รองรับทั้งการเทียบกับ National_ID หรือช่องรหัสผ่านถ้ามี)
    // ตรงนี้ถ้าใช้รหัสบัตรประชาชนที่หมอลงไว้ให้เป็นรหัสผ่าน ให้เทียบกับ patient.National_ID
    const isValidPassword = (password === patient.National_ID) || (password === patient.Password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง' });
    }

    // หากถูกต้อง ส่งข้อมูลไอดีและชื่อกลับไปให้แอป Flutter
    res.json({
      message: 'เข้าสู่ระบบสำเร็จ',
      patient: {
        PatientID: patient.PatientID,
        First_Name: patient.First_Name,
        Phone: patient.Phone
      }
    });
  });
});

// ==========================================
// 1. API ฝั่งแอปคนไข้ (Patient Mobile App API)
// ==========================================

// บันทึกข้อมูล Workout
app.post('/api/workouts', (req, res) => {
  const { userId, exerciseName, totalReps, totalSets } = req.body;

  const query = `
    INSERT INTO workouts
    (user_id, exercise_name, total_reps, total_sets)
    VALUES (?, ?, ?, ?)
  `;

  db.query(
    query,
    [userId, exerciseName, totalReps, totalSets],
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.status(201).json({
        message: 'บันทึกข้อมูลลง MySQL สำเร็จ!',
        id: result.insertId
      });
    }
  );
});

// ดึงโปรแกรมกายภาพของคนไข้
app.get('/api/patient/program/:patientId', (req, res) => {
  const patientId = req.params.patientId;

  const query = `
    SELECT
      pp.ProgramID,
      pp.Start,
      pp.End,
      pe.ProgramExerciseID,
      pe.Target_Reps,
      pe.Target_Sets,
      el.ExerciseID,
      el.Category,
      el.Exercise_Name,
      el.Description,
      el.Reference_Video_URL
    FROM patient_program pp
    JOIN program_exercise pe
      ON pp.ProgramID = pe.ProgramID
    JOIN exercise_library el
      ON pe.ExerciseID = el.ExerciseID
    WHERE pp.PatientID = ?
    ORDER BY pp.Start DESC
  `;

  db.query(query, [patientId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({
        message: 'ไม่พบโปรแกรมการออกกำลังกายสำหรับคนไข้นี้'
      });
    }

    res.json(results);
  });
});

// บันทึก Session และผลการฝึกรายท่า
app.post('/api/patient/session', (req, res) => {
  const {
    patientId,
    programId,
    start,
    end,
    exercises
  } = req.body;

  if (
    patientId == null ||
    programId == null ||
    !Array.isArray(exercises)
  ) {
    return res.status(400).json({
      error: 'กรุณาระบุ patientId, programId และ exercises ให้ถูกต้อง'
    });
  }

  const sessionQuery = `
    INSERT INTO session (PatientID, ProgramID, Start, End)
    VALUES (?, ?, ?, ?)
  `;

  db.query(
    sessionQuery,
    [patientId, programId, start || new Date(), end || new Date()],
    (err, sessionResult) => {
      if (err) {
        return res.status(500).json({
          error: 'บันทึก Session ไม่สำเร็จ: ' + err.message
        });
      }

      const sessionId = sessionResult.insertId;

      if (exercises.length === 0) {
        return res.status(201).json({
          message: 'บันทึก Session สำเร็จ',
          sessionId
        });
      }

      const assessmentValues = exercises.map((ex) => [
        patientId,
        sessionId,
        ex.programExerciseID,
        ex.completedReps,
        ex.completedSets,
        ex.userNote || '',
        ex.feedbackScore || 'Normal',
        ex.start || new Date(),
        ex.end || new Date()
      ]);

      const assessmentQuery = `
        INSERT INTO pain_assessment
        (
          PatientID,
          SessionID,
          ProgramExerciseID,
          Completed_Reps,
          Completed_Sets,
          User_Note,
          Feedback_Score,
          Start,
          End
        )
        VALUES ?
      `;

      db.query(
        assessmentQuery,
        [assessmentValues],
        (err2) => {
          if (err2) {
            return res.status(500).json({
              error: 'บันทึกผลรายท่าไม่สำเร็จ: ' + err2.message,
              sessionId
            });
          }

          res.status(201).json({
            message: 'บันทึกผลการออกกำลังกายสำเร็จ!',
            sessionId
          });
        }
      );
    }
  );
});

// ==========================================
// 2. API สำหรับเว็บฝั่งหมอ (Doctor Web API)
// ==========================================

// API ดึงข้อมูลโปรไฟล์หมอ (GET)
app.get('/api/doctor/profile/:staffId', (req, res) => {
  const staffId = req.params.staffId;
  const query = 'SELECT * FROM medical_staff WHERE StaffID = ?';
  
  db.query(query, [staffId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'ไม่พบข้อมูลหมอ' });
    res.json(results[0]);
  });
});

// API อัปเดตข้อมูลโปรไฟล์หมอ (PUT)
app.put('/api/doctor/profile/:staffId', (req, res) => {
  const staffId = req.params.staffId;
  const { licenseNumber, firstName, lastName, department, position } = req.body;

  const query = `
    UPDATE medical_staff 
    SET License_Number = ?, First_Name = ?, Last_Name = ?, Department = ?, Position = ?
    WHERE StaffID = ?
  `;

  db.query(query, [licenseNumber, firstName, lastName, department, position, staffId], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'อัปเดตข้อมูลโปรไฟล์สำเร็จ!' });
  });
});

// เพิ่มข้อมูลผู้ป่วย
app.post('/api/doctor/add-patient', (req, res) => {
  const {
    staffId,
    baselineAssessment,
    medicalCondition,
    nationalId,
    phone,
    firstName,
    lastName,
    gender,
    dob,
    nationality,
    caregiverName,
    caregiverRelation,
    caregiverPhone
  } = req.body;

  const sql = `
    INSERT INTO patient
    (
      StaffID,
      Baseline_Assessment,
      Medical_Condition,
      National_ID,
      Phone,
      First_Name,
      Last_Name,
      Gender,
      DOB,
      Nationality,
      Caregiver_Name,
      Caregiver_Relation,
      Caregiver_Phone
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      staffId || 1,
      baselineAssessment,
      medicalCondition,
      nationalId,
      phone,
      firstName,
      lastName,
      gender,
      dob,
      nationality,
      caregiverName,
      caregiverRelation,
      caregiverPhone
    ],
    (err, result) => {
      if (err) {
        console.error('Error inserting patient:', err);
        return res.status(500).json({ error: err.message });
      }

      res.status(201).json({
        message: 'เพิ่มข้อมูลผู้ป่วยลงฐานข้อมูลสำเร็จ!',
        patientId: result.insertId
      });
    }
  );
});

// ดึงรายชื่อคนไข้ทั้งหมด
app.get('/api/doctor/patients', (req, res) => {
  const query = 'SELECT * FROM patient';

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
});

// ดึงประวัติการฝึก พร้อมเป้าหมายที่หมอกำหนด
app.get('/api/doctor/patient/:patientId/history', (req, res) => {
  const patientId = req.params.patientId;

  const query = `
    SELECT
      pa.AssessmentID,
      pa.SessionID,
      pa.ProgramExerciseID,
      pa.Completed_Reps,
      pa.Completed_Sets,
      pa.User_Note,
      pa.Feedback_Score,
      pa.Start,
      pa.End,
      pe.Target_Reps,
      pe.Target_Sets,
      el.Exercise_Name,
      el.Category
    FROM pain_assessment pa
    JOIN program_exercise pe
      ON pa.ProgramExerciseID = pe.ProgramExerciseID
    JOIN exercise_library el
      ON pe.ExerciseID = el.ExerciseID
    WHERE pa.PatientID = ?
    ORDER BY pa.Start DESC
  `;

  db.query(query, [patientId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
});

// ==========================================
// API ใหม่: ข้อมูลแดชบอร์ดรายคนไข้
// GET /api/doctor/patient/:patientId/dashboard
// ==========================================

app.get('/api/doctor/patient/:patientId/dashboard', (req, res) => {
  const patientId = req.params.patientId;

  const query = `
    SELECT
      pp.ProgramID,
      pp.Start AS ProgramStart,
      pp.End AS ProgramEnd,

      pe.ProgramExerciseID,
      pe.Target_Reps,
      pe.Target_Sets,

      el.ExerciseID,
      el.Exercise_Name,
      el.Category,

      COALESCE(SUM(pa.Completed_Reps), 0) AS Completed_Reps,
      COALESCE(SUM(pa.Completed_Sets), 0) AS Completed_Sets,
      COUNT(pa.AssessmentID) AS Assessment_Count,
      MAX(pa.Start) AS Last_Performed

    FROM patient_program pp

    INNER JOIN program_exercise pe
      ON pp.ProgramID = pe.ProgramID

    INNER JOIN exercise_library el
      ON pe.ExerciseID = el.ExerciseID

    LEFT JOIN pain_assessment pa
      ON pa.ProgramExerciseID = pe.ProgramExerciseID
      AND pa.PatientID = pp.PatientID

    WHERE pp.PatientID = ?

    GROUP BY
      pp.ProgramID,
      pp.Start,
      pp.End,
      pe.ProgramExerciseID,
      pe.Target_Reps,
      pe.Target_Sets,
      el.ExerciseID,
      el.Exercise_Name,
      el.Category

    ORDER BY pp.Start DESC, pe.ProgramExerciseID ASC
  `;

  db.query(query, [patientId], (err, results) => {
    if (err) {
      console.error('Dashboard API error:', err);

      return res.status(500).json({
        message: 'ไม่สามารถดึงข้อมูลแดชบอร์ดได้',
        error: err.message
      });
    }

    res.json(results);
  });
});

// มอบหมายโปรแกรมกายภาพให้คนไข้
app.post('/api/doctor/assign-program', (req, res) => {
  const {
    patientId,
    startDate,
    endDate,
    exercises
  } = req.body;

  if (patientId == null || !Array.isArray(exercises)) {
    return res.status(400).json({
      error: 'กรุณาระบุ patientId และ exercises ให้ถูกต้อง'
    });
  }

  const programQuery = `
    INSERT INTO patient_program (PatientID, Start, End)
    VALUES (?, ?, ?)
  `;

  db.query(
    programQuery,
    [patientId, startDate, endDate],
    (err, programResult) => {
      if (err) {
        return res.status(500).json({
          error: 'สร้างโปรแกรมไม่สำเร็จ: ' + err.message
        });
      }

      const programId = programResult.insertId;

      if (exercises.length === 0) {
        return res.status(201).json({
          message: 'สร้างโปรแกรมสำเร็จ',
          programId
        });
      }

      const exerciseValues = exercises.map((ex) => [
        programId,
        ex.exerciseId,
        ex.targetReps,
        ex.targetSets
      ]);

      const peQuery = `
        INSERT INTO program_exercise
        (ProgramID, ExerciseID, Target_Reps, Target_Sets)
        VALUES ?
      `;

      db.query(peQuery, [exerciseValues], (err2) => {
        if (err2) {
          return res.status(500).json({
            error: 'เพิ่มท่าในโปรแกรมไม่สำเร็จ: ' + err2.message,
            programId
          });
        }

        res.status(201).json({
          message: 'มอบหมายโปรแกรมกายภาพสำเร็จ!',
          programId
        });
      });
    }
  );
});

// เพิ่มท่ากายภาพในคลัง
app.post('/api/doctor/exercise-library', (req, res) => {
  const {
    category,
    exerciseName,
    description,
    videoUrl
  } = req.body;

  const query = `
    INSERT INTO exercise_library
    (Category, Exercise_Name, Description, Reference_Video_URL)
    VALUES (?, ?, ?, ?)
  `;

  db.query(
    query,
    [category, exerciseName, description, videoUrl],
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.status(201).json({
        message: 'เพิ่มท่ากายภาพในคลังสำเร็จ!',
        exerciseId: result.insertId
      });
    }
  );
});

// ==========================================
// เริ่มต้น Backend Server
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend เซิร์ฟเวอร์กำลังรันอยู่ที่พอร์ต ${PORT}`);
});