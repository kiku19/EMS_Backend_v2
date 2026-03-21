/**
 * Localized string tables for email templates.
 * Supported locales: en, hi, ta, te, kn, ur
 *
 * Usage in emailService.js:
 *   import { getEmailStrings, interp } from '../utils/emailTemplates.js';
 *   const s = getEmailStrings(lang);
 *   const html = `<p>${interp(s.welcome.greeting, { name: user.name })}</p>`;
 */

const EMAIL_STRINGS = {
  en: {
    welcome: {
      subject: 'Welcome to School Management System',
      header: 'Welcome to {{schoolName}}',
      greeting: 'Dear {{name}},',
      accountCreated: 'Your account has been created successfully.',
      loginCredentials: 'Login Credentials:',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      getStarted: 'Please log in to your account to get started.',
      loginButton: 'Login Now',
    },
    announcement: {
      greeting: 'Dear {{name}},',
      thankYou: 'Thank you,',
      attachments: 'Attachments:',
    },
    reminder: {
      greeting: 'Dear {{name}},',
      takeAction: 'Please take necessary action.',
      thankYou: 'Thank you,',
    },
    feeReminder: {
      subject: '💰 Fee Payment Reminder - {{studentName}}',
      header: '💰 Fee Payment Reminder',
      greeting: 'Dear Parent/Guardian,',
      reminderBefore: 'This is a reminder that the fee payment for',
      reminderAfter: 'is due.',
      feeType: 'Fee Type:',
      amount: 'Amount:',
      dueDate: 'Due Date:',
      avoidLateFees: 'Please ensure timely payment to avoid late fees.',
      payButton: 'Pay Now',
    },
    attendanceAlert: {
      subject: 'Attendance Alert - {{studentName}}',
      header: 'Attendance Alert',
      greeting: 'Dear Parent/Guardian,',
      infoBefore: 'We would like to inform you about the attendance of',
      infoAfter: '',
      date: 'Date:',
      status: 'Status:',
      reason: 'Reason:',
      present: 'Present',
      absent: 'Absent',
      contactSchool: 'Please contact the school administration if you have any questions.',
    },
    schoolWelcome: {
      subject: 'Welcome to SchoolSync — {{schoolName}} is ready!',
      header: 'Welcome to SchoolSync!',
      readyToGo: '{{schoolName}} is ready to go',
      greeting: 'Hi {{name}},',
      trialBefore: "Your school account has been created successfully. You're now on a",
      trialAfter: '-day free trial',
      noCCRequired: 'no credit card required.',
      schoolLabel: 'School:',
      codeLabel: 'School Code:',
      emailLabel: 'Your email:',
      getStarted: 'Log in to start setting up your school — add classes, staff, and students.',
      loginButton: 'Log In to SchoolSync',
      ignoreText: "If you didn't create this account, you can safely ignore this email.",
      verifyTitle: 'Verify your email address',
      verifyText: 'Click the button below to confirm your email and activate your account.',
      verifyButton: 'Verify Email Address',
    },
    common: {
      rights: 'All rights reserved.',
      schoolManagement: 'School Management System',
      schoolAdministration: 'School Administration',
    },
  },

  hi: {
    welcome: {
      subject: 'स्कूल प्रबंधन प्रणाली में आपका स्वागत है',
      header: '{{schoolName}} में आपका स्वागत है',
      greeting: 'प्रिय {{name}},',
      accountCreated: 'आपका खाता सफलतापूर्वक बनाया गया है।',
      loginCredentials: 'लॉगिन क्रेडेंशियल:',
      emailLabel: 'ईमेल',
      passwordLabel: 'पासवर्ड',
      getStarted: 'शुरू करने के लिए अपने खाते में लॉगिन करें।',
      loginButton: 'अभी लॉगिन करें',
    },
    announcement: {
      greeting: 'प्रिय {{name}},',
      thankYou: 'धन्यवाद,',
      attachments: 'संलग्नक:',
    },
    reminder: {
      greeting: 'प्रिय {{name}},',
      takeAction: 'कृपया आवश्यक कार्रवाई करें।',
      thankYou: 'धन्यवाद,',
    },
    feeReminder: {
      subject: '💰 शुल्क भुगतान अनुस्मारक - {{studentName}}',
      header: '💰 शुल्क भुगतान अनुस्मारक',
      greeting: 'प्रिय अभिभावक/संरक्षक,',
      reminderBefore: 'यह एक अनुस्मारक है कि',
      reminderAfter: 'का शुल्क भुगतान देय है।',
      feeType: 'शुल्क प्रकार:',
      amount: 'राशि:',
      dueDate: 'देय तिथि:',
      avoidLateFees: 'देर से भुगतान शुल्क से बचने के लिए समय पर भुगतान सुनिश्चित करें।',
      payButton: 'अभी भुगतान करें',
    },
    attendanceAlert: {
      subject: 'उपस्थिति अलर्ट - {{studentName}}',
      header: 'उपस्थिति अलर्ट',
      greeting: 'प्रिय अभिभावक/संरक्षक,',
      infoBefore: 'हम आपको',
      infoAfter: 'की उपस्थिति के बारे में सूचित करना चाहते हैं।',
      date: 'तिथि:',
      status: 'स्थिति:',
      reason: 'कारण:',
      present: 'उपस्थित',
      absent: 'अनुपस्थित',
      contactSchool: 'यदि आपके कोई प्रश्न हैं तो कृपया स्कूल प्रशासन से संपर्क करें।',
    },
    schoolWelcome: {
      subject: 'SchoolSync में आपका स्वागत है — {{schoolName}} तैयार है!',
      header: 'SchoolSync में आपका स्वागत है!',
      readyToGo: '{{schoolName}} तैयार है',
      greeting: 'नमस्ते {{name}},',
      trialBefore: 'आपका स्कूल खाता सफलतापूर्वक बनाया गया है। आप अब',
      trialAfter: '-दिन के निःशुल्क परीक्षण पर हैं',
      noCCRequired: 'कोई क्रेडिट कार्ड आवश्यक नहीं।',
      schoolLabel: 'स्कूल:',
      codeLabel: 'स्कूल कोड:',
      emailLabel: 'आपका ईमेल:',
      getStarted: 'अपने स्कूल को सेट अप करना शुरू करें — कक्षाएं, कर्मचारी और छात्र जोड़ें।',
      loginButton: 'SchoolSync में लॉगिन करें',
      ignoreText: 'यदि आपने यह खाता नहीं बनाया है, तो आप इस ईमेल को अनदेखा कर सकते हैं।',
      verifyTitle: 'अपना ईमेल पता सत्यापित करें',
      verifyText:
        'अपना ईमेल पुष्टि करने और अपना खाता सक्रिय करने के लिए नीचे दिए गए बटन पर क्लिक करें।',
      verifyButton: 'ईमेल पता सत्यापित करें',
    },
    common: {
      rights: 'सर्वाधिकार सुरक्षित।',
      schoolManagement: 'स्कूल प्रबंधन प्रणाली',
      schoolAdministration: 'स्कूल प्रशासन',
    },
  },

  ta: {
    welcome: {
      subject: 'பள்ளி மேலாண்மை அமைப்பில் வரவேற்கிறோம்',
      header: '{{schoolName}} இல் வரவேற்கிறோம்',
      greeting: 'அன்புள்ள {{name}},',
      accountCreated: 'உங்கள் கணக்கு வெற்றிகரமாக உருவாக்கப்பட்டது.',
      loginCredentials: 'உள்நுழைவு சான்றுகள்:',
      emailLabel: 'மின்னஞ்சல்',
      passwordLabel: 'கடவுச்சொல்',
      getStarted: 'தொடங்க உங்கள் கணக்கில் உள்நுழையவும்.',
      loginButton: 'இப்போது உள்நுழையவும்',
    },
    announcement: {
      greeting: 'அன்புள்ள {{name}},',
      thankYou: 'நன்றி,',
      attachments: 'இணைப்புகள்:',
    },
    reminder: {
      greeting: 'அன்புள்ள {{name}},',
      takeAction: 'தயவுசெய்து தேவையான நடவடிக்கை எடுக்கவும்.',
      thankYou: 'நன்றி,',
    },
    feeReminder: {
      subject: '💰 கட்டண நினைவூட்டல் - {{studentName}}',
      header: '💰 கட்டண நினைவூட்டல்',
      greeting: 'அன்புள்ள பெற்றோர்/பாதுகாவலர்,',
      reminderBefore: 'இது ஒரு நினைவூட்டல்:',
      reminderAfter: 'இன் கட்டணம் செலுத்த வேண்டியதிருக்கிறது.',
      feeType: 'கட்டண வகை:',
      amount: 'தொகை:',
      dueDate: 'கடைசி தேதி:',
      avoidLateFees: 'தாமதக் கட்டணத்தை தவிர்க்க சரியான நேரத்தில் செலுத்தவும்.',
      payButton: 'இப்போது செலுத்தவும்',
    },
    attendanceAlert: {
      subject: 'வருகை எச்சரிக்கை - {{studentName}}',
      header: 'வருகை எச்சரிக்கை',
      greeting: 'அன்புள்ள பெற்றோர்/பாதுகாவலர்,',
      infoBefore: 'நாங்கள்',
      infoAfter: 'இன் வருகை பற்றி உங்களுக்கு தெரிவிக்க விரும்புகிறோம்.',
      date: 'தேதி:',
      status: 'நிலை:',
      reason: 'காரணம்:',
      present: 'வருகை',
      absent: 'வருகையில்லாமல்',
      contactSchool: 'ஏதேனும் கேள்விகள் இருந்தால் பள்ளி நிர்வாகத்தை தொடர்பு கொள்ளவும்.',
    },
    schoolWelcome: {
      subject: 'SchoolSync இல் வரவேற்கிறோம் — {{schoolName}} தயாராக உள்ளது!',
      header: 'SchoolSync இல் வரவேற்கிறோம்!',
      readyToGo: '{{schoolName}} தயாராக உள்ளது',
      greeting: 'வணக்கம் {{name}},',
      trialBefore: 'உங்கள் பள்ளி கணக்கு வெற்றிகரமாக உருவாக்கப்பட்டது. நீங்கள் இப்போது',
      trialAfter: '-நாள் இலவச சோதனையில் உள்ளீர்கள்',
      noCCRequired: 'கிரெடிட் கார்டு தேவையில்லை.',
      schoolLabel: 'பள்ளி:',
      codeLabel: 'பள்ளி குறியீடு:',
      emailLabel: 'உங்கள் மின்னஞ்சல்:',
      getStarted:
        'உங்கள் பள்ளியை அமைக்க தொடங்குங்கள் — வகுப்புகள், ஊழியர்கள் மற்றும் மாணவர்களை சேர்க்கவும்.',
      loginButton: 'SchoolSync இல் உள்நுழையவும்',
      ignoreText: 'நீங்கள் இந்த கணக்கை உருவாக்கவில்லை என்றால், இந்த மின்னஞ்சலை புறக்கணிக்கலாம்.',
      verifyTitle: 'உங்கள் மின்னஞ்சல் முகவரியை சரிபார்க்கவும்',
      verifyText: 'உங்கள் மின்னஞ்சலை உறுதிப்படுத்த கீழேயுள்ள பொத்தானை கிளிக் செய்யவும்.',
      verifyButton: 'மின்னஞ்சல் முகவரியை சரிபார்க்கவும்',
    },
    common: {
      rights: 'அனைத்து உரிமைகளும் பாதுகாக்கப்பட்டவை.',
      schoolManagement: 'பள்ளி மேலாண்மை அமைப்பு',
      schoolAdministration: 'பள்ளி நிர்வாகம்',
    },
  },

  te: {
    welcome: {
      subject: 'స్కూల్ మేనేజ్‌మెంట్ సిస్టమ్‌కి స్వాగతం',
      header: '{{schoolName}} కి స్వాగతం',
      greeting: 'ప్రియమైన {{name}},',
      accountCreated: 'మీ ఖాతా విజయవంతంగా సృష్టించబడింది.',
      loginCredentials: 'లాగిన్ ఆధారాలు:',
      emailLabel: 'ఇమెయిల్',
      passwordLabel: 'పాస్‌వర్డ్',
      getStarted: 'ప్రారంభించడానికి మీ ఖాతాలోకి లాగిన్ చేయండి.',
      loginButton: 'ఇప్పుడు లాగిన్ చేయండి',
    },
    announcement: {
      greeting: 'ప్రియమైన {{name}},',
      thankYou: 'ధన్యవాదాలు,',
      attachments: 'జోడింపులు:',
    },
    reminder: {
      greeting: 'ప్రియమైన {{name}},',
      takeAction: 'దయచేసి అవసరమైన చర్య తీసుకోండి.',
      thankYou: 'ధన్యవాదాలు,',
    },
    feeReminder: {
      subject: '💰 రుసుము చెల్లింపు రిమైండర్ - {{studentName}}',
      header: '💰 రుసుము చెల్లింపు రిమైండర్',
      greeting: 'ప్రియమైన తల్లిదండ్రులు/సంరక్షకులు,',
      reminderBefore: 'ఇది ఒక రిమైండర్:',
      reminderAfter: 'యొక్క రుసుము చెల్లింపు గడువు తీరింది.',
      feeType: 'రుసుము రకం:',
      amount: 'మొత్తం:',
      dueDate: 'చెల్లింపు గడువు:',
      avoidLateFees: 'ఆలస్య రుసుమును నివారించడానికి సకాలంలో చెల్లించండి.',
      payButton: 'ఇప్పుడు చెల్లించండి',
    },
    attendanceAlert: {
      subject: 'హాజరు హెచ్చరిక - {{studentName}}',
      header: 'హాజరు హెచ్చరిక',
      greeting: 'ప్రియమైన తల్లిదండ్రులు/సంరక్షకులు,',
      infoBefore: 'మేము',
      infoAfter: 'యొక్క హాజరు గురించి మీకు తెలియజేయాలనుకుంటున్నాం.',
      date: 'తేదీ:',
      status: 'స్థితి:',
      reason: 'కారణం:',
      present: 'హాజరు',
      absent: 'గైర్హాజరు',
      contactSchool: 'మీకు ఏమైనా సందేహాలు ఉంటే దయచేసి పాఠశాల నిర్వాహణను సంప్రదించండి.',
    },
    schoolWelcome: {
      subject: 'SchoolSync కి స్వాగతం — {{schoolName}} సిద్ధంగా ఉంది!',
      header: 'SchoolSync కి స్వాగతం!',
      readyToGo: '{{schoolName}} సిద్ధంగా ఉంది',
      greeting: 'నమస్కారం {{name}},',
      trialBefore: 'మీ పాఠశాల ఖాతా విజయవంతంగా సృష్టించబడింది. మీరు ఇప్పుడు',
      trialAfter: '-రోజుల ఉచిత ట్రయల్‌లో ఉన్నారు',
      noCCRequired: 'క్రెడిట్ కార్డు అవసరం లేదు.',
      schoolLabel: 'పాఠశాల:',
      codeLabel: 'పాఠశాల కోడ్:',
      emailLabel: 'మీ ఇమెయిల్:',
      getStarted:
        'మీ పాఠశాలను సెటప్ చేయడం ప్రారంభించండి — తరగతులు, సిబ్బంది మరియు విద్యార్థులను జోడించండి.',
      loginButton: 'SchoolSync లో లాగిన్ చేయండి',
      ignoreText: 'మీరు ఈ ఖాతాను సృష్టించకుంటే, ఈ ఇమెయిల్‌ను నిరాకరించవచ్చు.',
      verifyTitle: 'మీ ఇమెయిల్ చిరునామాను ధృవీకరించండి',
      verifyText:
        'మీ ఇమెయిల్ నిర్ధారించడానికి మరియు మీ ఖాతాను యాక్టివేట్ చేయడానికి దిగువ బటన్‌ను క్లిక్ చేయండి.',
      verifyButton: 'ఇమెయిల్ చిరునామాను ధృవీకరించండి',
    },
    common: {
      rights: 'అన్ని హక్కులు రిజర్వ్ చేయబడ్డాయి.',
      schoolManagement: 'స్కూల్ మేనేజ్‌మెంట్ సిస్టమ్',
      schoolAdministration: 'పాఠశాల నిర్వాహణ',
    },
  },

  kn: {
    welcome: {
      subject: 'ಶಾಲಾ ನಿರ್ವಹಣಾ ವ್ಯವಸ್ಥೆಗೆ ಸ್ವಾಗತ',
      header: '{{schoolName}} ಗೆ ಸ್ವಾಗತ',
      greeting: 'ಆತ್ಮೀಯ {{name}},',
      accountCreated: 'ನಿಮ್ಮ ಖಾತೆಯನ್ನು ಯಶಸ್ವಿಯಾಗಿ ರಚಿಸಲಾಗಿದೆ.',
      loginCredentials: 'ಲಾಗಿನ್ ರುಜುವಾತುಗಳು:',
      emailLabel: 'ಇಮೇಲ್',
      passwordLabel: 'ಪಾಸ್‌ವರ್ಡ್',
      getStarted: 'ಪ್ರಾರಂಭಿಸಲು ನಿಮ್ಮ ಖಾತೆಗೆ ಲಾಗಿನ್ ಮಾಡಿ.',
      loginButton: 'ಈಗ ಲಾಗಿನ್ ಮಾಡಿ',
    },
    announcement: {
      greeting: 'ಆತ್ಮೀಯ {{name}},',
      thankYou: 'ಧನ್ಯವಾದಗಳು,',
      attachments: 'ಲಗತ್ತುಗಳು:',
    },
    reminder: {
      greeting: 'ಆತ್ಮೀಯ {{name}},',
      takeAction: 'ದಯವಿಟ್ಟು ಅಗತ್ಯ ಕ್ರಮ ತೆಗೆದುಕೊಳ್ಳಿ.',
      thankYou: 'ಧನ್ಯವಾದಗಳು,',
    },
    feeReminder: {
      subject: '💰 ಶುಲ್ಕ ಪಾವತಿ ಜ್ಞಾಪನ - {{studentName}}',
      header: '💰 ಶುಲ್ಕ ಪಾವತಿ ಜ್ಞಾಪನ',
      greeting: 'ಆತ್ಮೀಯ ಪೋಷಕರು/ಪಾಲಕರು,',
      reminderBefore: 'ಇದು ಒಂದು ಜ್ಞಾಪನ:',
      reminderAfter: 'ರ ಶುಲ್ಕ ಪಾವತಿ ಬಾಕಿ ಇದೆ.',
      feeType: 'ಶುಲ್ಕ ವಿಧ:',
      amount: 'ಮೊತ್ತ:',
      dueDate: 'ಕೊನೆ ದಿನಾಂಕ:',
      avoidLateFees: 'ತಡ ಶುಲ್ಕ ತಪ್ಪಿಸಲು ಸಮಯಕ್ಕೆ ಪಾವತಿ ಮಾಡಿ.',
      payButton: 'ಈಗ ಪಾವತಿ ಮಾಡಿ',
    },
    attendanceAlert: {
      subject: 'ಹಾಜರಾತಿ ಎಚ್ಚರಿಕೆ - {{studentName}}',
      header: 'ಹಾಜರಾತಿ ಎಚ್ಚರಿಕೆ',
      greeting: 'ಆತ್ಮೀಯ ಪೋಷಕರು/ಪಾಲಕರು,',
      infoBefore: 'ನಾವು',
      infoAfter: 'ರ ಹಾಜರಾತಿ ಬಗ್ಗೆ ನಿಮಗೆ ತಿಳಿಸಲು ಬಯಸುತ್ತೇವೆ.',
      date: 'ದಿನಾಂಕ:',
      status: 'ಸ್ಥಿತಿ:',
      reason: 'ಕಾರಣ:',
      present: 'ಹಾಜರು',
      absent: 'ಗೈರುಹಾಜರು',
      contactSchool: 'ನಿಮಗೆ ಯಾವುದೇ ಪ್ರಶ್ನೆಗಳಿದ್ದರೆ ಶಾಲಾ ಆಡಳಿತವನ್ನು ಸಂಪರ್ಕಿಸಿ.',
    },
    schoolWelcome: {
      subject: 'SchoolSync ಗೆ ಸ್ವಾಗತ — {{schoolName}} ಸಿದ್ಧವಾಗಿದೆ!',
      header: 'SchoolSync ಗೆ ಸ್ವಾಗತ!',
      readyToGo: '{{schoolName}} ಸಿದ್ಧವಾಗಿದೆ',
      greeting: 'ನಮಸ್ಕಾರ {{name}},',
      trialBefore: 'ನಿಮ್ಮ ಶಾಲಾ ಖಾತೆಯನ್ನು ಯಶಸ್ವಿಯಾಗಿ ರಚಿಸಲಾಗಿದೆ. ನೀವು ಈಗ',
      trialAfter: '-ದಿನಗಳ ಉಚಿತ ಪ್ರಯೋಗದಲ್ಲಿದ್ದೀರಿ',
      noCCRequired: 'ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್ ಅಗತ್ಯವಿಲ್ಲ.',
      schoolLabel: 'ಶಾಲೆ:',
      codeLabel: 'ಶಾಲಾ ಕೋಡ್:',
      emailLabel: 'ನಿಮ್ಮ ಇಮೇಲ್:',
      getStarted:
        'ನಿಮ್ಮ ಶಾಲೆಯನ್ನು ಹೊಂದಿಸಲು ಪ್ರಾರಂಭಿಸಿ — ತರಗತಿಗಳು, ಸಿಬ್ಬಂದಿ ಮತ್ತು ವಿದ್ಯಾರ್ಥಿಗಳನ್ನು ಸೇರಿಸಿ.',
      loginButton: 'SchoolSync ಗೆ ಲಾಗಿನ್ ಮಾಡಿ',
      ignoreText: 'ನೀವು ಈ ಖಾತೆಯನ್ನು ರಚಿಸದಿದ್ದರೆ, ಈ ಇಮೇಲ್ ಅನ್ನು ನಿರ್ಲಕ್ಷಿಸಬಹುದು.',
      verifyTitle: 'ನಿಮ್ಮ ಇಮೇಲ್ ವಿಳಾಸ ಪರಿಶೀಲಿಸಿ',
      verifyText: 'ನಿಮ್ಮ ಇಮೇಲ್ ದೃಢೀಕರಿಸಲು ಮತ್ತು ಖಾತೆ ಸಕ್ರಿಯಗೊಳಿಸಲು ಕೆಳಗಿನ ಬಟನ್ ಕ್ಲಿಕ್ ಮಾಡಿ.',
      verifyButton: 'ಇಮೇಲ್ ವಿಳಾಸ ಪರಿಶೀಲಿಸಿ',
    },
    common: {
      rights: 'ಎಲ್ಲ ಹಕ್ಕುಗಳನ್ನು ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.',
      schoolManagement: 'ಶಾಲಾ ನಿರ್ವಹಣಾ ವ್ಯವಸ್ಥೆ',
      schoolAdministration: 'ಶಾಲಾ ಆಡಳಿತ',
    },
  },

  ur: {
    welcome: {
      subject: 'اسکول مینجمنٹ سسٹم میں خوش آمدید',
      header: '{{schoolName}} میں خوش آمدید',
      greeting: 'عزیز {{name}},',
      accountCreated: 'آپ کا اکاؤنٹ کامیابی سے بنایا گیا ہے۔',
      loginCredentials: 'لاگ ان اعتماد نامے:',
      emailLabel: 'ای میل',
      passwordLabel: 'پاس ورڈ',
      getStarted: 'شروع کرنے کے لیے اپنے اکاؤنٹ میں لاگ ان کریں۔',
      loginButton: 'ابھی لاگ ان کریں',
    },
    announcement: {
      greeting: 'عزیز {{name}},',
      thankYou: 'شکریہ,',
      attachments: 'منسلکات:',
    },
    reminder: {
      greeting: 'عزیز {{name}},',
      takeAction: 'براہ کرم ضروری کارروائی کریں۔',
      thankYou: 'شکریہ,',
    },
    feeReminder: {
      subject: '💰 فیس ادائیگی یاددہانی - {{studentName}}',
      header: '💰 فیس ادائیگی یاددہانی',
      greeting: 'عزیز والدین/سرپرست,',
      reminderBefore: 'یہ ایک یاددہانی ہے کہ',
      reminderAfter: 'کی فیس ادائیگی واجب ہے۔',
      feeType: 'فیس کی قسم:',
      amount: 'رقم:',
      dueDate: 'آخری تاریخ:',
      avoidLateFees: 'تاخیر کی فیس سے بچنے کے لیے وقت پر ادائیگی یقینی بنائیں۔',
      payButton: 'ابھی ادا کریں',
    },
    attendanceAlert: {
      subject: 'حاضری الرٹ - {{studentName}}',
      header: 'حاضری الرٹ',
      greeting: 'عزیز والدین/سرپرست,',
      infoBefore: 'ہم آپ کو',
      infoAfter: 'کی حاضری کے بارے میں مطلع کرنا چاہتے ہیں۔',
      date: 'تاریخ:',
      status: 'حالت:',
      reason: 'وجہ:',
      present: 'حاضر',
      absent: 'غیر حاضر',
      contactSchool: 'اگر آپ کے کوئی سوالات ہیں تو اسکول انتظامیہ سے رابطہ کریں۔',
    },
    schoolWelcome: {
      subject: 'SchoolSync میں خوش آمدید — {{schoolName}} تیار ہے!',
      header: 'SchoolSync میں خوش آمدید!',
      readyToGo: '{{schoolName}} تیار ہے',
      greeting: 'السلام علیکم {{name}},',
      trialBefore: 'آپ کا اسکول اکاؤنٹ کامیابی سے بنایا گیا ہے۔ آپ اب',
      trialAfter: '-دن کے مفت ٹرائل پر ہیں',
      noCCRequired: 'کریڈٹ کارڈ کی ضرورت نہیں۔',
      schoolLabel: 'اسکول:',
      codeLabel: 'اسکول کوڈ:',
      emailLabel: 'آپ کا ای میل:',
      getStarted: 'اپنے اسکول کو ترتیب دینا شروع کریں — کلاسیں، عملہ اور طلبہ شامل کریں۔',
      loginButton: 'SchoolSync میں لاگ ان کریں',
      ignoreText: 'اگر آپ نے یہ اکاؤنٹ نہیں بنایا تو آپ اس ای میل کو نظرانداز کر سکتے ہیں۔',
      verifyTitle: 'اپنا ای میل ایڈریس تصدیق کریں',
      verifyText: 'اپنا ای میل تصدیق کرنے اور اکاؤنٹ فعال کرنے کے لیے نیچے دیے بٹن پر کلک کریں۔',
      verifyButton: 'ای میل ایڈریس تصدیق کریں',
    },
    common: {
      rights: 'جملہ حقوق محفوظ ہیں۔',
      schoolManagement: 'اسکول مینجمنٹ سسٹم',
      schoolAdministration: 'اسکول انتظامیہ',
    },
  },
};

/**
 * Supported locale codes matching SchoolSettings.language.supportedLanguages enum.
 */
export const SUPPORTED_EMAIL_LOCALES = ['en', 'hi', 'ta', 'te', 'kn', 'ur'];

/**
 * Get the localized email string table for a given locale.
 * Falls back to English if the locale is unsupported.
 *
 * @param {string} [locale='en']
 * @returns {typeof EMAIL_STRINGS.en}
 */
export function getEmailStrings(locale = 'en') {
  return EMAIL_STRINGS[locale] ?? EMAIL_STRINGS.en;
}

/**
 * Simple {{key}} template interpolation for email strings.
 *
 * @param {string} str - Template string containing {{key}} placeholders
 * @param {Object} vars - Variable map, e.g. { name: 'John', schoolName: 'ABC School' }
 * @returns {string}
 */
export function interp(str, vars) {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v ?? '')), str);
}
