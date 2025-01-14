const fs = require('fs');
const path = require('path');
const acl = require("../acl/");
const { v4: uuidv4 } = require('uuid');

class IAM {
    constructor(server) {
        this.server = server;
    }
    /**
     * Registering a new user
     * @param userId
     * @param name
     * @param email
     * @param userGroups
     * @param password
     */
    addUser(userId, name, email, userGroups, password) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = new acl_1.User();
            user.userId = userId;
            user.name = name;
            user.email = email;
            user.userGroups = userGroups;
            user.password = password;
            yield acl_1.User.Repository(this.server).insert([user]);
            return user;
        });
    }
    /**
     * Returns a userKey for a given user
     * Temporary bypass to authentication
     * Bypassing authentication, assuming the an API Key was already provided
     * @param userId
     */
    getRemoteUser(userId) {
        let key;
        IAM.currentUsers.forEach((user, ukey) => {
            if (user.userId === userId) {
                key = ukey;
            }
        });
        if (key)
            return key;
        let user = new acl_1.User();
        user.userId = userId;
        key = uuidv4();
        IAM.currentUsers.set(key, user);
        return key;
    }
    login(userId, password) {
        return __awaiter(this, void 0, void 0, function* () {
            const users = yield acl_1.User.Repository(this.server).find({ userId: userId, password: password });
            if (users.length == 0)
                return null;
            const user = users[0];
            const key = uuidv4();
            IAM.currentUsers.set(key, user);
            return key;
        });
    }
    /**
     * Returns a UserProfile for an already authenticated user
     *
     * @param key
     */
    getCurrentUser(key) {
        //console.log(IAM.currentUsers);
        const user = IAM.currentUsers.get(key);
        return user;
    }
    getUser(userId) {
        return __awaiter(this, void 0, void 0, function* () {
            const users = yield acl_1.User.Repository(this.server).find({ userId: userId });
            return users[0];
        });
    }
    getUsersForGroup(userGroup) {
        return __awaiter(this, void 0, void 0, function* () {
            const users = yield acl_1.User.Repository(this.server).find({ userGroups: userGroup });
            return users;
        });
    }
}
exports.IAM = IAM;
IAM.currentUsers = new Map();
