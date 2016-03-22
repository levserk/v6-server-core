'use strict';

module.exports = class Room {

    static get TYPE_SINGLE() {
        return 'single';
    }

    static get TYPE_MULTY() {
        return 'multy';
    }

    constructor() {
        this.id = null;
        this.owner = null;
        this.players = [];
        this.spectators = [];
        this.inviteData = null;
        this.mode = null;
        this.game = null;
        this.timeout = false;
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

    getGameData(userId) {
        let history = this.gameData.shistory;
        if (userId === 'spectator') {
            history = this.gameData.phistory;
        }
        if (userId && this.hasPlayer(userId)){
            history = this.userData[userId].shistory;
        }
        history = history || '';
        return {
            roomInfo: this.getInfo(),
            initData: this.gameData.initData,
            state: this.gameData.state,
            score: this.getScore(),
            history: history,
            nextPlayer: this.gameData.current,
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
        return {};
        //let usersTakeBacks = {};
        //for (var i = 0; i < this.players.length; i++) {
        //    usersTakeBacks[this.players[i]] = this.data[this.players[i]].takeBacks;
        //}
        //return usersTakeBacks;
    }

    getDataToSave() {
        return {
            room: this.id, //?
            owner: this.owner,
            players: JSON.stringify(this.players),
            spectators: JSON.stringify(this.spectators),
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
            timeout: this.timeout,
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
            userId = userId.toString();
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
        room.saveHistory = data.saveHistory;
        room.saveRating = data.saveRating;
        room.timeMode = data.timeMode;
        room.timeStartMode = data.timeStartMode;
        room.turnTime = +data.turnTime;
        room.addTime = +data.addTime;
        room.timeout = data.timeout;
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
        this.gameState = 'playing';
        this.gameData.initData = initData;
        this.gameData.shistory = '';
        this.gameData.phistory = '';
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
            this.userData[userId].shistory = '';
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

    leavePlayer(userId) {
        for (let i = 0; i < this.players.length; i++) {
            if (this.players[i] === userId) {
                this.players.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    saveUserTurn(userTurn, nextPlayerId) {
        userTurn.userTurnTime = this.getTurnTime(nextPlayerId);
        userTurn.userTime = this.userTime;

        let stringUserTurn = JSON.stringify(userTurn);

        // history for save
        if (this.gameData.shistory.length > 0) {
            this.gameData.shistory += '@';
        }
        this.gameData.shistory += stringUserTurn;
        //history for spectators
        if (this.gameData.phistory.length > 0) {
            this.gameData.phistory += '@';
        }
        this.gameData.phistory += stringUserTurn;
        //history for players
        for (let playerId of this.players) {
            let userHistory = this.userData[playerId].shistory || '';
            if (userHistory.length > 0) {
                userHistory += '@';
            }
            userHistory += stringUserTurn;
            this.userData[playerId].shistory = userHistory;
        }

        return userTurn;
    }

    saveUserEvent(event, userId) {
        let stringUserEvent = JSON.stringify(event);

        if (this.gameData.shistory.length > 0) {
            this.gameData.shistory += '@';
        }
        this.gameData.shistory += stringUserEvent;

        if (!userId) {
            if (this.gameData.phistory.length > 0) {
                this.gameData.phistory += '@';
            }
            this.gameData.phistory += stringUserEvent;
        }

        for (let playerId of this.players) {
            if (!userId || playerId === userId) {
                let userHistory = this.userData[userId].shistory || '';
                if (userHistory.length > 0) {
                    userHistory += '@';
                }
                userHistory += stringUserEvent;
                this.userData[userId].shistory = userHistory;
            }
        }
    }

    updateTurnTime(nextPlayerId) {
        let game = this.gameData;
        let userTurnTime = game.turnStartTime ? Date.now() - game.turnStartTime : 0;
        this.userData[this.currentId].userTotalTime += userTurnTime;
        if (nextPlayerId !== this.currentId && this.timeMode === 'dont_reset') {
            this.userData[this.currentId].userTurnTime -= userTurnTime;
            // TODO: check if user time is out, time can be < 0
        }
        if (nextPlayerId !== this.currentId ||
            this.timeMode === 'reset_every_turn' ||
            (this.timeStartMode === 'after_turn' && !this.timeout) ||
            (this.timeStartMode === 'after_round_start' && !this.timeout) ||
            (this.timeMode === 'common' && !this.timeout)
        ) { // start new timeout
            if (nextPlayerId !== this.currentId) {
                this.userData[this.currentId].userTurnTime += this.addTime;
            }
            this.currentId = nextPlayerId;
            this.gameData.turnStartTime = Date.now();
            this.timeout = true;
            return true;
        } else { // do not start new timeout
            return false;
        }
    }

    getTurnTime(userId) {
        if (!userId) {
            userId = this.currentId;
        }
        return this.userData[userId].userTurnTime;
    }

    get userTime() {
        return Date.now() - (this.gameData.turnStartTime || this.gameData.timeStart);
    }

    hasPlayer(userId) {
        return this.players.indexOf(userId) > -1;
    }

    isMulty() {
        return this.type === 'multy';
    }

    isGameStateWaiting() {
        return this.gameData.state === 'waiting';
    }

    isGameStatePlaying() {
        return this.gameData.state === 'playing';
    }

    isGameStateClosing() {
        return this.gameData.state === 'closing';
    }

    get gameTimeStart() {
        return this.gameData.timeStart;
    }

    get gameState() {
        return this.gameData.state;
    }

    set gameState(state) {
        this.gameData.state = state;
    }

    get currentId() {
        return this.gameData.current;
    }

    set currentId(userId) {
        this.gameData.current = userId;
    }

    get turnStartTime() {
        return this.gameData.turnStartTime;
    }

};