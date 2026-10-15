const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ตั้งค่าเชื่อมต่อ MySQL (ปรับ username / password ของเครื่องคุณฟาง)
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '', // ถ้าไม่มีรหัสผ่าน ปล่อยว่างไว้
  database: 'remotionrehab_db' // ชื่อฐานข้อมูลใน MySQL
});

db.connect((err) => {
  if (err) {
    console.error('เชื่อมต่อ MySQL ไม่สำเร็จ:', err);
    return;
  }
  console.log('เชื่อมต่อฐานข้อมูล MySQL สำเร็จแล้ว!');
});

// สร้าง API สำหรับรับข้อมูลการออกกำลังกายจากแอป Flutter
app.post('/api/workouts', (req, res) => {
  const { userId, exerciseName, totalReps, totalSets } = req.body;
  
  const query = 'INSERT INTO workouts (user_id, exercise_name, total_reps, total_sets) VALUES (?, ?, ?, ?)';
  db.query(query, [userId, exerciseName, totalReps, totalSets], (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ message: 'บันทึกข้อมูลลง MySQL สำเร็จ!', id: result.insertId });
  });
});

// เปิดเซิร์ฟเวอร์ที่พอร์ต 3000
app.listen(3000, () => {
  console.log('Backend เซิร์ฟเวอร์กำลังรันอยู่ที่ http://localhost:3000');
});


// ==========================================
// 1. API ดึงโปรแกรมและรายการท่าของคนไข้
// ==========================================
app.get('/api/patient/program/:patientId', (req, res) => {
  const patientId = req.params.patientId;

  // ค้นหาโปรแกรมที่คนไข้คนนี้ได้รับมอบหมาย และดึงท่าออกกำลังกายทั้งหมดออกมา
  const query = `
    SELECT 
      pp.ProgramID, pp.Start, pp.End,
      pe.ProgramExerciseID, pe.Target_Reps, pe.Target_Sets,
      el.ExerciseID, el.Category, el.Exercise_Name, el.Description, el.Reference_Video_URL
    FROM patient_program pp
    JOIN program_exercise pe ON pp.ProgramID = pe.ProgramID
    JOIN exercise_library el ON pe.ExerciseID = el.ExerciseID
    WHERE pp.PatientID = ?
  `;

  db.query(query, [patientId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: 'ไม่พบโปรแกรมการออกกำลังกายสำหรับคนไข้นี้' });
    }
    res.json(results);
  });
});

// ==========================================
// 2. API บันทึกผลการออกกำลังกาย (Session & Pain Assessment)
// ==========================================
app.post('/api/patient/session', (req, res) => {
  const { patientId, programId, start, end, exercises } = req.body; 
  // exercises จะเป็น Array ส่งข้อมูลรายท่าที่ทำ เช่น [{ programExerciseID, completedReps, completedSets, userNote, feedbackScore }]

  // ขั้นตอนที่ 1: บันทึกลงตาราง Session ก่อน
  const sessionQuery = 'INSERT INTO session (PatientID, ProgramID, Start, End) VALUES (?, ?, ?, ?)';
  db.query(sessionQuery, [patientId, programId, start, end], (err, sessionResult) => {
    if (err) {
      return res.status(500).json({ error: 'บันทึก Session ไม่สำเร็จ: ' + err.message });
    }

    const sessionId = sessionResult.insertId;

    // ขั้นตอนที่ 2: วนลูปบันทึกผลลัพธ์แต่ละท่าลงตาราง Pain_Assessment
    if (exercises && exercises.length > 0) {
      const assessmentValues = exercises.map(ex => [
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
        (PatientID, SessionID, ProgramExerciseID, Completed_Reps, Completed_Sets, User_Note, Feedback_Score, Start, End) 
        VALUES ?
      `;

      db.query(assessmentQuery, [assessmentValues], (err2, result2) => {
        if (err2) {
          return res.status(500).json({ error: 'บันทึกผลรายท่าไม่สำเร็จ: ' + err2.message });
        }
        res.status(201).json({ message: 'บันทึกผลการออกกำลังกายทั้งหมดลง MySQL สำเร็จ!', sessionId });
      });
    } else {
      res.status(201).json({ message: 'บันทึก Session สำเร็จ (ไม่มีข้อมูลรายท่า)', sessionId });
    }
  });
});