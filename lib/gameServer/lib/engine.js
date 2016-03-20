'use strict';
let co = require('co');
let moduleName = 'Engine';
let logger, log, err, wrn;

module.exports = class Engine {

    static get USER_READY() {
        return 'user_ready';
    }

    static get ROUND_START() {
        return 'round_start';
    }

    static get ROUND_END() {
        return 'round_end';
    }

    static get USER_TURN() {
        return 'user_turn';
    }

    static get USER_EVENT() {
        return 'user_event';
    }

    static get USER_TIMEOUT() {
        return 'user_timeout';
    }

    static get USER_LEAVE() {
        return 'user_leave';
    }

    constructor(gameManager, conf) {
        this.gm = gameManager;
        this.server = this.gm.server;

        logger = this.server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        this.isRuning = false;
    }

    init() {
        this.isRuning = true;
        return new Promise((res) => {
            res(true);
        });
    }

    onMessage(type, room, user, data) {
        switch (type) {
            case Engine.USER_READY:
                return this.onUserReady(room, user, data);
            case Engine.USER_LEAVE:
                return this.onUserLeave(room, user);
            case Engine.USER_TURN:
                return this.onUserTurn(room, user, data);
            case Engine.USER_EVENT:
                return this.onUserEvent(room, user, data);
            case Engine.USER_TIMEOUT:
                return this.onTimeout(room);
            default:
                return Promise.resolve(true);
        }
    }

    onUserReady(room, user, data) {
        let self = this;
        return co(function* () {
            room.setUserReady(user.userId);

            yield self.gm.sendUserReady(room, user, { user: user.userId, ready: data });

            if (!room.checkPlayersReady()) {
                return Promise.resolve(true);
            }
            // all players ready
            yield self.initGame(room);

            yield self.gm.sendRoundStart(room);

            if (room.timeStartMode === 'after_round_start'){
                yield self.updateTime(room, room.currentId);
            }
        });
    }

    initGame(room, initData) {
        return new Promise((res) => {
            initData = initData || {};
            room.initGame(this.setFirst(room), initData);
            res(true);
        });
    }

    setFirst(room) {
        if (!room.game.first) {
            return room.owner;
        }
        return room.getOpponent(room.game.first);
    }

    onUserTurn(room, user, turn) {
        let self = this, game = room.game;
        return co(function* () {
            let userTurn = yield self.doTurn(room, user, turn);
            if (!userTurn || typeof userTurn !== "object") { // wrong turn
                err(`onUserTurn`, `wrong turn: ${JSON.stringify(turn)}, userTurn: ${userTurn}}`, 1);
                yield self.gm.sendError(game, user, 'wrong_turn');
                return Promise.resolve(false);
            }

            let nextPlayerId = yield self.switchPlayer(room, user, turn);

            if (nextPlayerId !== room.currentId ) {  // if switch player
                userTurn.nextPlayer = nextPlayerId;
                //room.game.turns++;
                //room.askTakeBack = null;
                //room.data[user.userId].userTurns++;
                //if (room.data[user.userId].focusChanged){
                //    logger.err('GameManager.onUserTurn, turn after focus change ', user.userId, 3);
                //    room.data[user.userId].userUnfocusedTurns++;
                //    room.data[user.userId].focusChanged = false;
                //}
            }

            userTurn = room.savePlayerTurn(userTurn, nextPlayerId);

            yield self.gm.sendUserTurn(room, user, userTurn);

            // check endGame
            let isGameEnd = yield self.checkGameEnd(room, user, turn, 'turn');
            // send game event on user turn if need
            if (!isGameEnd) {
            //    yield self.sendEvent(room, this.engine.gameEvent(room, user, turn, false));
                yield self.updateTime(room, nextPlayerId);
            }

            return true;
        });
    }

    doTurn(room, user, turn) {
        return Promise.resolve(turn);
    }

    switchPlayer(room, user, turn) {
        let nextPlayer = room.getOpponent(user.userId);
        return Promise.resolve(nextPlayer);
    }

    updateTime (room, nextPlayerId) {
        if (room.updateTurnTime(nextPlayerId)){
            return this.gm.setTimeout(room, nextPlayerId);
        } else {
            return Promise.resolve(true);
        }
    }

    checkGameEnd(room, user, data, type) {
        let self = this, gameEnd= false;
        return co(function* () {
            if (data.result === 1) {
                gameEnd = true;
                yield self.onRoundEnd(room, {
                    winner: user.userId,
                    action: 'game_over'
                });
            }
            return gameEnd;
        });
    }

    onTimeout(room) {
        let self = this, game = room.game;
        return co(function* () {
            let user = yield self.server.getUser(game, room.currentId);
            yield self.onUserTimeout(room, user);
        });
    }

    onUserTimeout(room, user){
        room.timeout = false;
        return this.onUserLose(room, user, 'timeout');
    }

    onUserEvent(room, user, event) {
        switch (event.type) {
            case 'throw':
                return this.onThrow(room, user, event);
            case 'draw':
                return this.onDraw(room, user, event);
            case 'back':
                return this.onTakeBack(room, user, event);
            case 'focus':
                return this.onWindowFocus(room, user, event);
            default:
                return this.onUserGameEvent(room, user, event);
        }
    }

    onThrow(room, user) {
        return this.onUserLose(room, user, 'throw');
    }

    onUserLose(room, user, action) {
        let winnerId = room.getOpponent(user.userId);
        log(`onUserLose`, `${room.id}, winner ${winnerId}, losser: ${user.userId}`);
        return this.onRoundEnd(room, {
            winner: winnerId,
            action: action
        });
    }

    onUserLeave(room, user) {
        let self = this;
        return co(function* () {
            yield self.onUserLose(room, user, 'user_throw');
            yield self.gm.sendUserLeave(room, user);
            yield self.gm.sendGameEnd(room);
        });
    }

    onRoundEnd(room, result) {
        if (!room.isGameStatePlaying()) {
            log(`onRoundEnd`, `game not playing! ${room.id}'`, 2);
            return Promise.resolve(false);
        }

        let self = this, game = room.game, mode = room.mode;

        return co(function* () {
            //clear timeout ??
            //if (room.timeout) clearTimeout(room.timeout);
            //room.timeout = null;

            result.timeStart = room.gameTimeStart;
            result.timeEnd = Date.now();
            result.time = result.timeEnd - result.timeStart;
            result.ratingsBefore = {}; result.ratings = {};

            let players = [];
            for (let playerId of room.players) {
                let user = yield self.server.getUser(game, playerId);
                if (!user) {
                    throw  Error(`user ${playerId} not exists in ${game}`);
                }
                players.push(user);
                result.ratings[playerId] = result.ratingsBefore[playerId] = user.getMode(mode, true);
            }

            result = yield self.addResultScores(room, result);
            result.save = yield self.getResultSave(room, result);
            result.action = yield self.getResultAction(room, result);

            log(`onRoundEnd`, `result before ratings calc: ${JSON.stringify(result)}`, 1);

            // waiting next round
            room.gameState = 'waiting';

            if (result.save) {
                yield self.updateGameScore(room, result);
                // self.checkCheaters(room, result);
                result = yield self.computeRatings(room, result, players);
            }

            log(`onRoundEnd`, `result after ratings calc: ${JSON.stringify(result)}`, 1);

            return self.gm.sendRoundEnd(room, result, players);
        });
    }

    addResultScores(room, result) {
        return Promise.resolve(result);
    }

    getResultSave(room, result) {
        let save = true;
        return Promise.resolve(save);
    }

    getResultAction(room, result) {
        let action = result.action || 'game_over';
        return Promise.resolve(action);
    }

    updateGameScore(room, result) {
        room.games++;
        if (result.winner) {
            room.userData[result.winner].win++;
        }
        return Promise.resolve(result);
    }

    computeRatings(room, result, players) {
        let mode = room.mode, game = room.game;
        if (players.length !== 2) {
            err(`computeRatings`, `wrong count of players (${players.length})! ${room.game}, ${room.mode} `, 1);
            return Promise.resolve(result);
        }

        // rating elo
        let winner, loser;
        if (result.winner === players[1].userId) {
            winner = players[1];
            loser = players[0];
        } else {
            winner = players[0];
            loser = players[1];
        }
        winner.getMode(mode)['games']++;
        loser.getMode(mode)['games']++;
        loser.getMode(mode)['timeLastGame'] = winner.getMode(mode)['timeLastGame'] = result.timeStart;

        if (!result.winner) {
            winner.getMode(mode)['draw']++;
            loser.getMode(mode)['draw']++;
            this.computeRatingElo(mode, winner, loser, true);

        } else {
            winner.getMode(mode)['win']++;
            loser.getMode(mode)['lose']++;
            this.computeRatingElo(mode, winner, loser);
        }

        for (let player of players) {
            result.ratings[player.userId] = player.getMode(mode, true);
        }

        return Promise.resolve(result);
    }


    onWindowFocus(room, user) {
        return Promise.resolve(true);
    }


    computeRatingElo(mode, winner, loser, isDraw) {
        if (isDraw) {
            winner.getMode(mode)['ratingElo'] = this.eloCalculation(winner.getMode(mode)['ratingElo'], loser.getMode(mode)['ratingElo'], 0.5,
                winner.getMode(mode)['games'] < 30);
            loser.getMode(mode)['ratingElo'] = this.eloCalculation(loser.getMode(mode)['ratingElo'], winner.getMode(mode)['ratingElo'], 0.5,
                loser.getMode(mode)['games'] < 30);
        } else {
            winner.getMode(mode)['ratingElo'] = this.eloCalculation(winner.getMode(mode)['ratingElo'], loser.getMode(mode)['ratingElo'], 1,
                winner.getMode(mode)['games'] < 30);
            loser.getMode(mode)['ratingElo'] = this.eloCalculation(loser.getMode(mode)['ratingElo'], winner.getMode(mode)['ratingElo'], 0,
                loser.getMode(mode)['games'] < 30);
        }
    }

    eloCalculation(player1Elo, player2Elo, sFaktor, isNovice) {
        let kFactor = 15;
        if (player1Elo >= 2400) {
            kFactor = 10;
        }
        else if (isNovice) {
            kFactor = 30;
        }
        let expectedScoreWinner = 1 / ( 1 + Math.pow(10, (player2Elo - player1Elo) / 400) );
        let e = kFactor * (sFaktor - expectedScoreWinner);
        return player1Elo + Math.floor(e); // ~~e
    }
};