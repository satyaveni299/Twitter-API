const express = require('express')
const path = require('path')

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const app = express()
app.use(express.json())
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const existingUsersQuery = `SELECT * FROM user WHERE username='${username}';`
  const res = await db.get(existingUsersQuery)
  if (res !== undefined) {
    response.status(400).send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400).send('Password is too short')
    } else {
      const hashedPass = await bcrypt.hash(password, 10)
      const registeQuery = `INSERT INTO user(name,username,password,gender)
        VALUES('${name}','${username}','${hashedPass}','${gender}');
        `
      await db.run(registeQuery)
      response.send('User created successfully')
    }
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid User')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid Password')
    }
  }
})
const verifyLoggedInUser = (request, response, next) => {
  let jwtToken
  const autheader = request.headers['authorization']
  if (autheader !== undefined) {
    jwtToken = autheader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401).send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.send('Invalid Acces Token')
      } else {
        request.user = payload
        next()
      }
    })
  }
}
app.get('/user/tweets/feed/', verifyLoggedInUser, async (request, response) => {
  const {user_id} = request.query
  const query = `
    SELECT u.username, t.tweet, t.date_time AS dateTime
    FROM follower f
    JOIN tweet t ON f.following_user_id = t.user_id
    JOIN user u ON t.user_id = u.user_id
    WHERE f.follower_user_id =${user_id}
    ORDER BY t.date_time DESC
    LIMIT 4;
  `
  const res = await db.all(query)
  response.send(res)
})
app.get('/user/following/', verifyLoggedInUser, async (request, response) => {
  const {user_id} = request.query
  const query = `
   SELECT user.name 
  FROM user 
  JOIN follower 
  ON user.user_id = follower.following_user_id
  WHERE follower.follower_user_id = ${user_id};`
  const res = await db.all(query)
  response.send(res)
})
app.get('/user/followers/', verifyLoggedInUser, async (request, response) => {
  const {user_id} = request.query
  const query = `
   SELECT user.name 
  FROM user 
  JOIN follower 
  ON user.user_id = follower.following_user_id
  WHERE follower.following_user_id = ${user_id};`
  const res = await db.all(query)
  response.send(res)
})
app.get('/tweets/:tweetId/', verifyLoggedInUser, async (request, response) => {
  const {tweetId} = request.params
  const {username} = request.user
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${username}';`
  const row = await db.get(getUserIdQuery)
  const userId = row.user_id
  const checkFollowerQuery = `
      SELECT tweet.tweet, tweet.date_time AS dateTime,
             (SELECT COUNT(*) FROM like WHERE tweet_id = ${tweetId}) AS likes,
             (SELECT COUNT(*) FROM reply WHERE tweet_id = ${tweetId}) AS replies
      FROM tweet
      JOIN follower ON follower.following_user_id = tweet.user_id
      WHERE follower.follower_user_id = ${userId} AND tweet.tweet_id = ${tweetId};
    `
  const tweet = await db.get(checkFollowerQuery)
  if (!tweet) {
    return response.status(401).send('Invalid Request') // User is not following the owner of the tweet
  } else {
    response.status(200).json({
      tweet: tweet.tweet,
      likes: tweet.likes,
      replies: tweet.replies,
      dateTime: tweet.dateTime,
    })
  }
})
app.get(
  '/tweets/:tweetId/likes/',
  verifyLoggedInUser,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request.user
    const getUserIdQuery = `SELECT user_id FROM user WHERE username='${username}';`
    const row = await db.get(getUserIdQuery)
    const userId = row.user_id
    const checkFollowerQuery = `
      SELECT tweet.tweet_id
      FROM tweet
      JOIN follower ON follower.following_user_id = tweet.user_id
      WHERE follower.follower_user_id = ${userId} AND tweet.tweet_id = ${tweetId};
    `
    const tweet = await db.get(checkFollowerQuery)
    if (!tweet) {
      return response.status(401).send('Invalid Request') // User is not following the owner of the tweet
    } else {
      const getLikesQuery = `
        SELECT u.username
        FROM like l
        JOIN user u ON l.user_id = u.user_id
        WHERE l.tweet_id = ?;
      `
      const likes = await db.all(getLikesQuery)
      if (!likes) {
        return response.status(401).send('Invalid Request') // User is not following the owner of the tweet
      }
      const likedUsernames = likes.map(like => like.username)
      response.send({likes: likedUsernames})
    }
  },
)
app.get('/user/tweets/', verifyLoggedInUser, async (request, response) => {
  const {username} = request.user
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${username}';`
  const row = await db.get(getUserIdQuery)
  const userId = row.user_id
  const getTweetsQuery = `
      SELECT t.tweet, t.date_time AS dateTime,
             (SELECT COUNT(*) FROM like WHERE tweet_id = t.tweet_id) AS likes,
             (SELECT COUNT(*) FROM reply WHERE tweet_id = t.tweet_id) AS replies
      FROM tweet t
      WHERE t.user_id = ${userId};
    `
  const tweets = await db.all(getTweetsQuery)
  const formattedTweets = tweets.map(tweet => ({
    tweet: tweet.tweet,
    likes: tweet.likes,
    replies: tweet.replies,
    dateTime: tweet.dateTime,
  }))

  response.send(formattedTweets)
})

app.post('/user/tweets/', verifyLoggedInUser, async (request, response) => {
  const {tweet} = request.body
  const {username} = request.user
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${username}';`
  const row = await db.get(getUserIdQuery)
  const userId = row.user_id
  const currentDateTime = new Date()
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ') // Format: YYYY-MM-DD HH:MM:SS

  // Insert the new tweet into the tweet table
  const insertTweetQuery = `INSERT INTO tweet (tweet, user_id, date_time) VALUES ('${tweet}', ${userId}, '${currentDateTime}')`
  await db.run(insertTweetQuery)
  response.send('Created a Tweet')
})
app.delete(
  '/tweets/:tweetId/',
  verifyLoggedInUser,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request.user
    const getUserIdQuery = `SELECT user_id FROM user WHERE username='${username}';`
    const row = await db.get(getUserIdQuery)
    const userId = row.user_id
    const checkTweetBelogsUserORnot = `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId}`
    const tweet = await db.get(checkTweetBelogsUserORnot)
    if (tweet.user_id !== userId) {
      return response.status(401).send('Invalid Request')
    }
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId}`
    await db.run(deleteTweetQuery)
    response.send('Tweet Removed')
  },
)
module.exports = app
