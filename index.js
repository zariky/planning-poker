const express = require("express");

const app = express();
const httpServer = require("http").Server(app);
const io = require("socket.io")(httpServer);

const PORT = process.env.PORT || 5000;

// io.listen(4113);
const rooms = new Map();
const clients = new Map();
const socketClientIdToUserMapping = {};

// const cors = require('cors');
// const bodyParser = require('body-parser');
// const morgan = require('morgan');
const history = require("connect-history-api-fallback");
// const port = process.env.PORT || 4000;
// app.use(morgan('tiny'));
// app.use(cors());
// app.use(bodyParser.json());
app.use(history());
app.use(express.static("./dist"));

function calcStatistics(votes) {
  return votes
    .filter(v => v)
    .reduce((acc, el) => {
      if (acc[el]) {
        acc[el] += 1;
      } else {
        acc[el] = 1;
      }
      return acc;
    }, {});
}

function finishRound(room) {
  room.roundFinished = true;
  const votes = Object.keys(room.users).reduce(
    (acc, uKey) => Object.assign(acc, { [uKey]: room.users[uKey].vote }),
    {}
  );
  io.in(room.roomId).emit("round_finished", {
    statistics: calcStatistics(Object.values(votes)),
    votes
  });
}

function finishRoundIfAllVoted(room) {
  if (
    room &&
    room.users &&
    Object.keys(room.users)
      .filter(uKey => !room.users[uKey].data.user.observer)
      .every(uKey => room.users[uKey].vote)
  ) {
    finishRound(room);
  }
}

io.on("connection", socket => {
  console.log("connect");

  socket.on("disconnect", reason => {
    console.info(`Client gone [id=${socket.id}], reason: ${reason}`);

    const userId = socket.id;
    const roomId = clients.get(userId);
    const room = rooms.get(roomId);

    if (room && room.users) {
      delete room.users[socket.id];
    }
    if (room && room.users && !Object.keys(room.users).length) {
      rooms.delete(roomId);
    }
    clients.delete(socket.id);

    console.log("rooms", rooms);
    console.log("clients", clients);
    socket.broadcast.to(roomId).emit("room_left", socket.id);
    finishRoundIfAllVoted(room);
  });

  socket.on("join", data => {
    console.info("join", data);

    const joinedUser = { id: socket.id, data };
    const roomId = joinedUser.data.room.id;
    let roomUsers = [];
    socketClientIdToUserMapping[joinedUser.id] = joinedUser;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        roomId,
        roundFinished: false,
        users: {
          [joinedUser.id]: joinedUser
        }
      });
    } else {
      const currentUsers = rooms.get(roomId).users;
      roomUsers = Object.keys(currentUsers).map(id => ({
        id,
        name: currentUsers[id].data.user.name,
        vote:
          joinedUser.data.user.observer && rooms.get(roomId).roundFinished
            ? currentUsers[id].vote
            : !!currentUsers[id].vote,
        observer: currentUsers[id].data.user.observer
      }));
      currentUsers[joinedUser.id] = joinedUser;
    }

    const room = rooms.get(roomId);
    if (!joinedUser.data.user.observer) {
      room.roundFinished = false;
    }
    clients.set(joinedUser.id, roomId);

    console.log("rooms", rooms);
    console.log("clients", clients);

    socket.join(roomId);
    // socket.emit('message', 'Welcome');
    /* socket.broadcast.emit sending to all clients except sender */
    socket.broadcast.to(roomId).emit("room_join", {
      id: socket.id,
      name: data.user.name,
      observer: data.user.observer
    });

    io.to(joinedUser.id).emit("init", {
      room: {
        roundFinished: room.roundFinished,
        users: roomUsers
      }
    });
    finishRoundIfAllVoted(room);
  });

  socket.on("vote", data => {
    const userId = socket.id;
    const room = rooms.get(data.roomId);
    const roomUsers = room.users;
    console.log(`User [${userId}] voted:`, data);

    if (room && roomUsers[userId]) {
      roomUsers[userId].vote = data.vote;
      console.log("room user", roomUsers[userId]);
    }

    socket.broadcast.to(room.roomId).emit("vote", { userId, vote: true });
    finishRoundIfAllVoted(room);
  });

  socket.on("show_votes", data => {
    const userId = socket.id;
    const room = rooms.get(data.roomId);
    console.log(`User [${userId}] requested SHOW ALL VOTES:`);
    const votes = Object.keys(room.users).reduce(
      (acc, uKey) => Object.assign(acc, { [uKey]: room.users[uKey].vote }),
      {}
    );
    // { votes: { ...acc.votes, [uKey]: room.users[uKey].vote } },

    io.in(room.roomId).emit("show_votes", { openUserId: room.users[userId].data.user.name, votes });
    finishRound(room);
  });

  socket.on("clear_votes", data => {
    const userId = socket.id;
    const room = rooms.get(data.roomId);
    console.log(`User [${userId}] requested CLEAR ALL VOTES:`);
    room.roundFinished = false;
    Object.keys(room.users).forEach(uId => {
      room.users[uId].vote = null;
    });
    io.in(room.roomId).emit("clear_votes");
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "Hello from Planning Poker!"
  });
});

httpServer.listen(PORT, () => {
  console.log(`go to http://localhost:${PORT}`);
});
