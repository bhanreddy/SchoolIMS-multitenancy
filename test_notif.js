import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_override_in_env_file', { expiresIn: '1h' });

axios.post('http://localhost:5000/admin/notifications/test-trigger', { type: 'ATTENDANCE_ABSENT' }, {
    headers: {
        Authorization: `Bearer ${token}`
    }
}).then(res => console.log(res.data)).catch(err => console.error(err.response?.data || err.message));
