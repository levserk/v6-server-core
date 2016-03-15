'use strict';

module.exports = class Room {
    constructor() {
        this.id = null;
        this.owner = null;
        this.players = [];
        this.spectators = [];
        this.inviteData = null;
        this.mode = null;
        this.game = null;
        this.timeout = null;//??
        this.games = 0; //??
        this.saveHistory = false;
        this.saveRating = false;
        this.timeMode = null;
        this.timeStartMode = null;
        this.turnTime = 0;
        this.addTime = 0;
        this.takeBacks = false;
        this.userTurnTime = null; //??
        this.createTime = null;
        this.type = null;
        this.gameData = {
            state: "waiting",
            current: null,
            timeStart: 0,
            turnStartTime: 0,
            shistory: null
        };
        this.userData = {};
    }

    getPlayerRoom(role) {
        return {
            roomId: this.id,
            role: role,
            type: this.type
        };
    }

    getInfo() {
        return {
            room: this.id,
            owner: this.owner,
            data: this.inviteData,
            players: this.players,
            spectators: this.spectators,
            mode: this.mode,
            type: this.type,
            turnTime: this.turnTime,
            addTime: this.addTime,
            takeBacks: this.takeBacks,
            timeMode: this.timeMode,
            timeStartMode: this.timeStartMode,
            saveHistory: this.saveHistory,
            saveRating: this.saveRating
        };
    }

    getGameData() {
        return {
            roomInfo: this.getInfo(),
            initData: this.gameData.initData,
            state: this.gameData.state,
            score: this.getScore(),
            history: this.gameData.state === 'waiting' ? '' : this.gameData.shistory, // TODO: clear history on round end, after saving game
            nextPlayer: this.gameData.current.userId,
            userTime: this.timeout ? Date.now() - this.gameData.turnStartTime : null,
            playerTurns: this.gameData.playerTurns,
            turnTime: this.turnTime,
            gameTime: this.createTime ? Date.now() - this.createTime : 0,
            roundTime: this.gameData.timeStart ? Date.now() - this.gameData.timeStart : 0,
            takeBacks: this.takeBacks,
            saveHistory: this.saveHistory,
            saveRating: this.saveRating,
            usersTakeBacks: this.getUsersTakeBacks(),
            userData: this.getUserData()
        };
    }

    getInitData() {
        let initData = this.gameData.initData;

        initData.inviteData = this.inviteData;
        initData.first = this.gameData.first;
        initData.id = this.id;
        initData.owner = this.owner;
        initData.players = [];
        initData.score = this.getScore();
        initData.turnTime = this.turnTime;
        initData.timeMode = this.timeMode;
        initData.timeStartMode = this.timeStartMode;
        initData.addTime = this.addTime;
        initData.saveHistory = this.saveHistory;
        initData.saveRating = this.saveRating;
        initData.players = this.players;

        return initData;
    }

    getUserData() {
        let data = {}, id;
        for (let i = 0; i < this.players.length; i++) {
            id = this.players[i];
            data[id] = {
                userTotalTime: this.userData[id].userTotalTime,
                userTurnTime: this.userData[id].userTurnTime,
                takeBacks: this.userData[id].takeBacks,
                win: this.userData[id].win
            };
        }
        return data;
    }

    getScore() {
        var score = {
            games: this.games
        };
        for (var i = 0; i < this.players.length; i++) {
            score[this.players[i]] = this.userData[this.players[i]].win;
        }
        return score;
    }

    getUsersTakeBacks() {
        var usersTakeBacks = {};
        for (var i = 0; i < this.players.length; i++) {
            usersTakeBacks[this.players[i]] = this.data[this.players[i]].takeBacks;
        }
        return usersTakeBacks;
    }

    getDataToSave() {
        return {
            room: this.id, //?
            owner: this.owner,
            players: JSON.stringify(this.players),
            spectators: JSON.stringify(this.players),
            inviteData: JSON.stringify(this.inviteData),
            mode: this.mode,
            type: this.type,
            game: this.game,
            games: this.games,
            saveHistory: this.saveHistory,
            saveRating: this.saveRating,
            timeMode: this.timeMode,
            timeStartMode: this.timeStartMode,
            turnTime: this.turnTime,
            addTime: this.addTime,
            takeBacks: this.takeBacks,
            createTime: this.createTime,
            userData: JSON.stringify(this.userData),
            gameData: JSON.stringify(this.gameData)
        };
    }

    static create(game, ownerSocket, ownerUserId, players, initData, inviteData, type) {
        let room = new Room();
        room.id = Room.generateRoomId(ownerSocket.socketId, ownerUserId, game, inviteData.mode);
        room.game = game;
        room.createTime = Date.now();
        room.players = players;
        room.owner = ownerUserId;
        room.inviteData = inviteData; // inviteData.data
        room.mode = inviteData.mode;
        room.type = type;

        room.gameData = {
            state: "waiting",
            current: ownerUserId,
            timeStart: 0,
            turnStartTime: 0,
            shistory: null
        };

        for (let userId of players) {
            room.userData[userId] = {
                ready: false,
                timeouts: 0,
                takeBacks: 0,
                win: 0
            };
        }

        room.saveHistory = initData.saveHistory !== false;
        room.saveRating = initData.saveRating !== false;
        room.turnTime = initData.turnTime < 1000 ? initData.turnTime * 1000 : initData.turnTime;
        room.timeMode = initData.timeMode;
        room.timeStartMode = initData.timeStartMode;
        room.addTime = initData.addTime;
        room.takeBacks = initData.takeBacks;
        room.maxTimeouts = initData.maxTimeouts;
        room.minTurns = initData.minTurns;

        return room;
    }

    static load(data) {
        if (typeof data === "string") {
            data = JSON.parse(data);
        }
        let room = new Room();
        room.id = data.room; //?
        room.owner = data.owner;
        room.players = JSON.parse(data.players);
        room.spectators = JSON.parse(data.spectators);
        room.inviteData = JSON.parse(data.inviteData);
        room.mode = data.mode;
        room.type = data.type;
        room.game = data.game;
        room.games = +data.games;
        room.saveHistory = data.saveHistory === 'true';
        room.saveRating = data.saveRating === 'true';
        room.timeMode = data.timeMode;
        room.timeStartMode = data.timeStartMode;
        room.turnTime = +data.turnTime;
        room.addTime = +data.addTime;
        room.takeBacks = +data.takeBacks;
        room.userTurnTime = +data.userTurnTime;
        room.createTime = +data.createTime;
        room.gameData = JSON.parse(data.gameData);
        room.userData = JSON.parse(data.userData);
        return room;
    }

    static generateRoomId(socketId, userId, game, mode) {
        //game format name: "game_type_userId_socketId_hh.mm.ss"
        var now = new Date();
        let id = `${game}_${mode}_${userId}_${socketId}_${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
        console.log(id);
        console.log(socketId, userId);
        return `${game}_${mode}_${userId}_${socketId}_${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
    }

    initGame(firstPlayerId, initData) {
        this.gameData.initData = initData;
        this.gameData.first = firstPlayerId;
        this.gameData.current = this.gameData.first;
        this.gameData.askDraw = null;
        this.gameData.askTakeBack = null;
        this.gameData.turns = 0;
        this.gameData.timeouts = 0;
        this.gameData.timeStart = Date.now();
        this.gameData.turnStartTime = null;
        this.userTurnTime = null;
        for (let userId of this.players) {
            this.userData[userId].userTurnTime = this.turnTime;
            this.userData[userId].userTotalTime = 0;
            this.userData[userId].focusChanged = false;
            this.userData[userId].userTurns = 0;
            this.userData[userId].userUnfocusedTurns = 0;
        }
    }

    setUserReady(userId) {
        this.userData[userId].ready = true;
    }

    checkPlayersReady() {
        for (let userId of this.players) {
            if (this.userData[userId].ready === false) {
                return false;
            }
        }
        return true;
    }

    getOpponent(userId) {
        for (let opponentId of this.players) {
            if (opponentId !== userId) {
                return opponentId;
            }
        }
        return false;
    }

    leaveSpectator(userId) {
        for (let i = 0; i < this.spectators.length; i++) {
            if (this.spectators[i] === userId) {
                this.spectators.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    isGameStateWaiting() {
        return this.gameData.state === 'waiting';
    }

    isGameStatePlaying() {
        return this.gameData.state === 'playing';
    }

};