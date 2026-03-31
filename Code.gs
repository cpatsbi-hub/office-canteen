// ============================================================
//  CANTEEN MANAGEMENT SYSTEM - Google Apps Script Backend
//  Deploy as Web App: Execute as "Me", Access: "Anyone"
// ============================================================
// SETUP: Go to Project Settings → Script Properties and add:
//   SHEET_ID      → Your Google Sheet ID (from URL)
//   SECRET_KEY    → Any random string (e.g. "mySuperSecret2024")
//   MANAGER_PASS  → Manager login password
//   USER_PAGE_URL → Your GitHub Pages user.html URL
// ============================================================

function doGet(e) {
  const callback = e.parameter.callback;
  try {
    const result = handleAction(e.parameter);
    const json = JSON.stringify(result);
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    const errJson = JSON.stringify({ success: false, message: err.toString() });
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + errJson + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(errJson)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleAction(params) {
  const props   = PropertiesService.getScriptProperties();
  const SECRET  = props.getProperty('SECRET_KEY')   || 'canteen2024';
  const MGR_PW  = props.getProperty('MANAGER_PASS') || 'manager123';
  const SHEET_ID = props.getProperty('SHEET_ID');

  if (!SHEET_ID) return { success: false, message: 'SHEET_ID not configured in Script Properties' };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const action = params.action;

  switch (action) {
    case 'register':            return registerUser(ss, params, SECRET);
    case 'login':               return loginUser(ss, params, SECRET);
    case 'forgotPassword':      return forgotPassword(ss, params);
    case 'resetPassword':       return resetPassword(ss, params, SECRET);
    case 'getMenu':             return getMenu(ss, params);
    case 'markAttendance':      return markAttendance(ss, params, SECRET);
    case 'checkAttendance':     return checkAttendance(ss, params, SECRET);
    case 'getMyAttendance':     return getMyAttendance(ss, params, SECRET);
    case 'managerLogin':        return managerLogin(params, MGR_PW, SECRET);
    case 'setMenu':             return setMenu(ss, params, MGR_PW, SECRET);
    case 'getStats':            return getStats(ss, params, MGR_PW, SECRET);
    case 'getAttendanceSummary':return getAttendanceSummary(ss, params, MGR_PW, SECRET);
    case 'getMonthlyData':      return getMonthlyData(ss, params, MGR_PW, SECRET);
    case 'getImages':           return getImages(ss, params, MGR_PW, SECRET);
    case 'addImage':            return addImage(ss, params, MGR_PW, SECRET);
    case 'deleteImage':         return deleteImage(ss, params, MGR_PW, SECRET);
    case 'getAllUsers':         return getAllUsers(ss, params, MGR_PW, SECRET);
    case 'ping':                return { success: true, message: 'Canteen API is alive!' };
    default:                    return { success: false, message: 'Unknown action: ' + action };
  }
}

// ──────────────────────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────────────────────

function hashStr(str) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function makeUserToken(empid, passHash, secret) {
  const payload = empid + ':' + hashStr(passHash + secret);
  return Utilities.base64EncodeWebSafe(payload);
}

function makeMgrToken(mgrPass, secret) {
  return 'MGR_' + hashStr(mgrPass + secret + '_manager_salt');
}

function verifyUserToken(ss, token, secret) {
  if (!token) return null;
  try {
    const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString();
    const [empid, tokenHash] = decoded.split(':');
    const sheet = ss.getSheetByName('Users');
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toUpperCase() === String(empid).toUpperCase()) {
        const expected = hashStr(data[i][3] + secret);
        if (tokenHash === expected) {
          return { id: data[i][0], empid: data[i][1], name: data[i][2], dept: data[i][4] };
        }
      }
    }
  } catch (e) {}
  return null;
}

function verifyMgrToken(token, mgrPass, secret) {
  return token === makeMgrToken(mgrPass, secret);
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold')
      .setBackground('#4a7c59').setFontColor('#ffffff');
  }
  return sheet;
}

function todayIST() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
}

// ──────────────────────────────────────────────────────────────
//  USER FUNCTIONS
// ──────────────────────────────────────────────────────────────

function registerUser(ss, p, secret) {
  const sheet = getOrCreateSheet(ss, 'Users', [
    'ID', 'EmpID', 'Name', 'PasswordHash', 'Department', 'SecurityQ', 'SecurityAHash', 'CreatedAt'
  ]);
  const data = sheet.getDataRange().getValues();

  const empid = (p.empid || '').trim().toUpperCase();
  const name  = (p.name  || '').trim();
  const pass  = p.password || '';
  const dept  = (p.dept  || '').trim();
  const secQ  = p.secQ   || '';
  const secA  = (p.secA  || '').trim().toLowerCase();

  if (!empid || !name || !pass || !dept || !secQ || !secA)
    return { success: false, message: 'All fields are required' };
  if (pass.length < 4)
    return { success: false, message: 'Password must be at least 4 characters' };

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toUpperCase() === empid)
      return { success: false, message: 'Employee ID already registered' };
  }

  const id       = 'U' + Date.now();
  const passHash = hashStr(pass + empid);
  const secAHash = hashStr(secA);
  sheet.appendRow([id, empid, name, passHash, dept, secQ, secAHash, new Date().toISOString()]);

  const token = makeUserToken(empid, passHash, secret);
  return { success: true, token, name, empid, dept, message: 'Welcome ' + name + '! Registration successful.' };
}

function loginUser(ss, p, secret) {
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return { success: false, message: 'No users registered yet' };

  const empid    = (p.empid || '').trim().toUpperCase();
  const pass     = p.password || '';
  const passHash = hashStr(pass + empid);
  const data     = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toUpperCase() === empid) {
      if (data[i][3] === passHash) {
        const token = makeUserToken(empid, passHash, secret);
        return { success: true, token, name: data[i][2], empid, dept: data[i][4] };
      }
      return { success: false, message: 'Incorrect password' };
    }
  }
  return { success: false, message: 'Employee ID not found. Please register first.' };
}

function forgotPassword(ss, p) {
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return { success: false, message: 'No users found' };

  const empid = (p.empid || '').trim().toUpperCase();
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toUpperCase() === empid)
      return { success: true, secQ: data[i][5], name: data[i][2] };
  }
  return { success: false, message: 'Employee ID not found' };
}

function resetPassword(ss, p, secret) {
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return { success: false, message: 'No users found' };

  const empid   = (p.empid || '').trim().toUpperCase();
  const secA    = (p.secA  || '').trim().toLowerCase();
  const newPass = p.newPass || '';

  if (!newPass || newPass.length < 4)
    return { success: false, message: 'New password must be at least 4 characters' };

  const secAHash = hashStr(secA);
  const data     = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toUpperCase() === empid) {
      if (data[i][6] !== secAHash)
        return { success: false, message: 'Security answer is incorrect' };
      const newHash = hashStr(newPass + empid);
      sheet.getRange(i + 1, 4).setValue(newHash);
      const token = makeUserToken(empid, newHash, secret);
      return { success: true, token, name: data[i][2], empid, dept: data[i][4], message: 'Password reset successfully!' };
    }
  }
  return { success: false, message: 'Employee ID not found' };
}

function getMenu(ss, p) {
  const date  = p.date || todayIST();
  const sheet = ss.getSheetByName('Menu');
  if (!sheet) return { success: true, menu: null };

  const data = sheet.getDataRange().getValues();
  // scan in reverse to get latest entry for the date
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === date) {
      return {
        success: true,
        menu: {
          date: data[i][0], name: data[i][1], description: data[i][2],
          imageUrl: data[i][3], setAt: data[i][5]
        }
      };
    }
  }
  return { success: true, menu: null };
}

function markAttendance(ss, p, secret) {
  const user = verifyUserToken(ss, p.token, secret);
  if (!user) return { success: false, message: 'Session expired. Please login again.' };

  const status = p.status;
  if (!['present', 'absent'].includes(status))
    return { success: false, message: 'Invalid status' };

  const today   = todayIST();
  const attSht  = getOrCreateSheet(ss, 'Attendance', [
    'Date', 'UserID', 'EmpID', 'Name', 'Department', 'Status', 'MarkedAt'
  ]);
  const data = attSht.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === today && data[i][1] === user.id)
      return { success: false, alreadyMarked: true, status: data[i][5],
               message: 'Attendance already marked as ' + data[i][5] };
  }

  attSht.appendRow([today, user.id, user.empid, user.name, user.dept, status, new Date().toISOString()]);
  return { success: true, status, message: 'Marked as ' + status + ' for today!' };
}

function checkAttendance(ss, p, secret) {
  const user = verifyUserToken(ss, p.token, secret);
  if (!user) return { success: false, message: 'Invalid session' };

  const today = todayIST();
  const sheet = ss.getSheetByName('Attendance');
  if (!sheet) return { success: true, marked: false };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === today && data[i][1] === user.id)
      return { success: true, marked: true, status: data[i][5] };
  }
  return { success: true, marked: false };
}

function getMyAttendance(ss, p, secret) {
  const user = verifyUserToken(ss, p.token, secret);
  if (!user) return { success: false, message: 'Invalid session' };

  const sheet = ss.getSheetByName('Attendance');
  if (!sheet) return { success: true, records: [] };

  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === user.id)
      records.push({ date: data[i][0], status: data[i][5], markedAt: data[i][6] });
  }
  records.sort((a, b) => b.date.localeCompare(a.date));
  return { success: true, records: records.slice(0, 60) };
}

// ──────────────────────────────────────────────────────────────
//  MANAGER FUNCTIONS
// ──────────────────────────────────────────────────────────────

function managerLogin(p, mgrPass, secret) {
  if ((p.password || '') === mgrPass) {
    return { success: true, token: makeMgrToken(mgrPass, secret), message: 'Welcome, Manager!' };
  }
  return { success: false, message: 'Invalid manager password' };
}

function setMenu(ss, p, mgrPass, secret) {
  if (!verifyMgrToken(p.mtoken, mgrPass, secret))
    return { success: false, message: 'Unauthorized' };

  const sheet = getOrCreateSheet(ss, 'Menu', ['Date', 'Name', 'Description', 'ImageURL', 'SetBy', 'SetAt']);
  const date  = p.date || todayIST();
  const name  = (p.name || '').trim();
  const desc  = (p.desc || '').trim();
  const img   = (p.imgUrl || '').trim();

  if (!name) return { success: false, message: 'Menu name is required' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === date) {
      sheet.getRange(i + 1, 1, 1, 6).setValues([[date, name, desc, img, 'Manager', new Date().toISOString()]]);
      return { success: true, message: 'Menu updated for ' + date };
    }
  }
  sheet.appendRow([date, name, desc, img, 'Manager', new Date().toISOString()]);
  return { success: true, message: 'Menu set for ' + date };
}

function getStats(ss, p, mgrPass, secret) {
  if (!verifyMgrToken(p.mtoken, mgrPass, secret))
    return { success: false, message: 'Unauthorized' };

  const today    = todayIST();
  const usersSht = ss.getSheetByName('Users');
  const attSht   = ss.getSheetByName('Attendance');
  const totalUsers = usersSht ? Math.max(0, usersSht.getLastRow() - 1) : 0;

  let todayPresent = 0, todayAbsent = 0;
  if (attSht) {
    const data = attSht.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === today) {
        if (data[i][5] === 'present') todayPresent++;
        else todayAbsent++;
      }
    }
  }
  const menuRes = getMenu(ss, { date: today });
  return { success: true, totalUsers, todayPresent, todayAbsent, todayTotal: todayPresent + todayAbsent, menu: menuRes.menu, today };
}

function getAttendanceSummary(ss, p, mgrPass, secret) {
  if (!verifyMgrToken(p.mtoken, mgrPass, secret))
    return { success: false, message: 'Unauthorized' };

  const date  = p.date || todayIST();
  const sheet = ss.getSheetByName('Attendance');
  if (!sheet) return { success: true, records: [], presentCount: 0, absentCount: 0, date };

  const data = sheet.getDataRange().getValues();
  const records = [];
  let presentCount = 0, absentCount = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === date) {
      records.push({ empid: data[i][2], name: data[i][3], dept: data[i][4], status: data[i][5], markedAt: data[i][6] });
      data[i][5] === 'present' ? presentCount++ : absentCount++;
    }
  }
  return { success: true, records, presentCount, absentCount, date };
}

function getMonthlyData(ss, p, mgrPass, secret) {
  if (!verifyMgrToken(p.mtoken, mgrPass, secret))
    return { success: false, message: 'Unauthorized' };

  const month = p.month || todayIST().slice(0, 7); // "yyyy-MM"
  const sheet = ss.getSheetByName('Attendance');
  if (!sheet) return { success: true, records: [], month };

  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && String(data[i][0]).startsWith(month))
      records.push({ date: data[i][0], empid: data[i][2], name: data[i][3], dept: data[i][4], status: data[i][5], markedAt: data[i][6] });
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { success: true, records, month };
}

function getImages(ss, p, mgrPass, secret) {
  // Images visible to all (for user page menu display) — no auth needed for read
  const sheet = ss.getSheetByName('Images');
  if (!sheet) return { success: true, images: [] };

  const data = sheet.getDataRange().getValues();
  const images = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0])
      images.push({ id: data[i][0], name: data[i][1], url: data[i][2], uploadedAt: data[i][3] });
  }
  return { success: true, images };
}

function addImage(ss, p, mgrPass, secret) {
  if (!verifyMgrToken(p.mtoken, mgrPass, secret))
    return { success: false, message: 'Unauthorized' };

  const name = (p.name || '').trim();
  const url  = (p.url  || '').trim();
  if (!name || !url) return { success: false, message: 'Name and URL required' };

  const sheet = getOrCreateSheet(ss, 'Images', ['ID', 'Name', 'URL', 'AddedAt']);
  const id    = 'IMG_' + Date.now();
  sheet.appendRow([id, name, url, new Date().toISOString()]);
  return { success: true, image: { id, name, url }, message: 'Image added!' };
}

function deleteImage(ss, p, mgrPass, secret) {
  if (!verifyMgrToken(p.mtoken, mgrPass, secret))
    return { success: false, message: 'Unauthorized' };

  const sheet = ss.getSheetByName('Images');
  if (!sheet) return { success: false, message: 'No images found' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      sheet.deleteRow(i + 1);
      return { success: true, message: 'Image deleted' };
    }
  }
  return { success: false, message: 'Image not found' };
}

function getAllUsers(ss, p, mgrPass, secret) {
  if (!verifyMgrToken(p.mtoken, mgrPass, secret))
    return { success: false, message: 'Unauthorized' };

  const sheet = ss.getSheetByName('Users');
  if (!sheet) return { success: true, users: [] };

  const data = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    users.push({ id: data[i][0], empid: data[i][1], name: data[i][2], dept: data[i][4], joinedAt: data[i][7] });
  }
  return { success: true, users };
}
