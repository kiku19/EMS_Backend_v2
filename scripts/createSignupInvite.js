import dotenv from 'dotenv';
import { generateSignupInvite } from '../utils/signupInvites.js';

dotenv.config();

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const email = readArg('email');
const schoolName = readArg('school');
const invitedBy = readArg('invited-by') || 'system';
const frontendUrl = (readArg('base-url') || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

if (!email || !schoolName) {
  console.error('Usage: npm run create:signup-invite -- --email admin@school.edu --school "Sunrise Public School" [--invited-by ops] [--base-url http://localhost:5173]');
  process.exit(1);
}

const token = generateSignupInvite({ email, schoolName, invitedBy });
const inviteUrl = `${frontendUrl}/signup?inviteToken=${encodeURIComponent(token)}`;

console.log('Signup invite generated');
console.log('');
console.log(`Email: ${email}`);
console.log(`School: ${schoolName}`);
console.log(`Invited by: ${invitedBy}`);
console.log('');
console.log(`Invite URL: ${inviteUrl}`);
console.log('');
console.log(`Raw token: ${token}`);
