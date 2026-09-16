import bcrypt from 'bcryptjs';

const hash = '$2b$10$nMai5e0RdLZ04qRIZ5GOsOc1IVfEE7ZVxYQ4kuky0416Wac4hkMDm';

async function check() {
  console.log('Checking "3624":', await bcrypt.compare('3624', hash));
  console.log('Checking "54589":', await bcrypt.compare('54589', hash));
}

check();
