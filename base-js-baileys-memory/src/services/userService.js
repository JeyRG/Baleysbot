import fs from 'fs';
import path from 'path';

const USER_DATA_PATH = path.join(process.cwd(), 'user_data.json');
const COUNTER_PATH = path.join(process.cwd(), 'leads_counter.json');

export const loadUsers = () => {
    try {
        if (fs.existsSync(USER_DATA_PATH)) {
            return JSON.parse(fs.readFileSync(USER_DATA_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('[Bot] Error al cargar user_data:', e);
    }
    return {};
};

export const saveUser = (id, data) => {
    try {
        const users = loadUsers();
        users[id] = { ...users[id], ...data };
        fs.writeFileSync(USER_DATA_PATH, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error('[Bot] Error al guardar user_data:', e);
    }
};

export const loadUserData = (id) => loadUsers()[id] || {};

export const resetUserData = (id) => {
    try {
        const users = loadUsers();
        delete users[id];
        fs.writeFileSync(USER_DATA_PATH, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error('[Bot] Error al resetear user_data:', e);
    }
};

export const getLeadsCounter = () => {
    try {
        if (!fs.existsSync(COUNTER_PATH)) {
            return { date: new Date().toISOString().split('T')[0], count: 0 };
        }
        const data = JSON.parse(fs.readFileSync(COUNTER_PATH, 'utf8'));
        const today = new Date().toISOString().split('T')[0];
        if (data.date !== today) return { date: today, count: 0 };
        return data;
    } catch (e) {
        return { date: new Date().toISOString().split('T')[0], count: 0 };
    }
};

export const incrementLeadsCounter = (limit = 50) => {
    const data = getLeadsCounter();
    if (data.count >= limit) return -1;
    data.count++;
    fs.writeFileSync(COUNTER_PATH, JSON.stringify(data), 'utf8');
    return data.count;
};
