const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())
const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const initDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('The Server is running at http://localhost:3000/')
    })
  } catch (err) {
    console.log(`Db error: ${err.message}`)
    process.exit(1)
  }
}
initDbAndServer()

const getFollowingPeopleId = async (username) => {
  const getFollowingPeople = `SELECT following_user_id FROM follower 
    INNER JOIN user ON user.user_id = follower.follower_user_id 
    WHERE user.username = '${username}';`
  const followingPeople = await db.all(getFollowingPeople)
  const arrayOfId = followingPeople.map(each => each.following_user_id)
  return arrayOfId
}
const authenticate = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken) {
    jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}
const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getTweet = `SELECT * FROM tweet INNER JOIN follower ON 
    tweet.user_id = follower.following_user_id WHERE tweet.tweet_id = '${tweetId}' AND follower.following_user_id='${userId}';`
  const tweet = await db.get(getTweet)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//API 1 register
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUser = `SELECT & FROM user WHERE username = '${username}';`
  const userDetails = await db.get(getUser)
  if (userDetails !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createUser = `INSERT INTO user (username, password, name, gender)
            VALUES ('${username}','${hashedPassword}','${name}','${gender}');`
      await db.run(createUser)
      response.send('User created successfully')
    }
  }
})

//API 2 login
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getUser = `SELECT * FROM user WHERE username='${username}';`
  const userDetails = await db.get(getUser)
  if (userDetails !== undefined) {
    const isPasswordCrct = await bcrypt.compare(password, userDetails.password)
    if (isPasswordCrct) {
      const payload = {username, userId: userDetails.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

//API 3 tweet from user
app.get('/user/tweets/feed/', authenticate, async (request, response) => {
  const {username} = request
  const followingPeople = await getFollowingPeopleId(username)
  const getTweet = `SELECT username, tweet, date_time AS dateTime FROM user
    INNER JOIN tweet ON user.user_id = tweet.user_id 
    WHERE user.user_id IN(${followingPeople}) ORDER BY date_time DESC LIMIT 4;`
  const tweets = await db.all(getTweet)
  response.send(tweets)
})

//API 4 get followers
app.get('/user/following/', authenticate, async (request, response) => {
  const {username, userId} = request
  const getFollowingUser = `SELECT name FROM follower INNER JOIN user ON
    user.user_id = follower.following_user_id WHERE follower_user_id='${userId}';`
  const followingPeople = await db.all(getFollowingUser)
  response.send(followingPeople)
})

//API 5 follower of user
app.get('/user/followers/', authenticate, async (request, response) => {
  const {username, userId} = request
  const getFollowers = `SELECT DISTINCT name FROM follower INNER JOIN user ON 
    user.user_id = follower.follower.user_id WHERE following_user_id = '${userId}';`
  const followers = await db.all(getFollowers)
  response.send(followers)
})

//API 6 get tweet
app.get(
  '/tweets/:tweetId/',
  authenticate,
  tweetAccessVerification,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const getTweet = `SELECT tweet, 
  (SELECT COUNT() FROM like WHERE tweet_id= '${tweetId}') AS likes,
  (SELECT COUNT() FROM reply WHERE tweet_id= '${tweetId}') AS replies,
  date_time AS dateTime FROM tweet WHERE tweet.tweet_id='${tweetId};`
    const tweet = await db.get(getTweet)
    response.send(tweet)
  },
)

//API 7 get tweet likes
app.get(
  '/tweets/:tweetId/likes/',
  authenticate,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikesQuery = `SELECT username FROM user INNER JOIN like ON 
  user.user_id=likeuser_id WHERE tweet_id='${tweetId}';`
    const likedUsers = await db.all(getLikesQuery)
    const userArr = likedUsers.map(each => each.username)
    response.send({likes: userArr})
  },
)

//API 8 get tweet replies
app.get(
  '/tweets/:tweetId/replies/',
  authenticate,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikesQuery = `SELECT name, reply FROM user INNER JOIN reply ON 
  user.user_id=reply.user_id WHERE tweet_id='${tweetId}';`
    const repliedUsers = await db.all(getLikesQuery)
    response.send({replies: repliedUsers})
  },
)

//API 9 get all tweets of user
app.get('/user/tweets/', authenticate, async (request, response) => {
  const {userId} = request
  const getTweet = `SELECT tweet, 
  COUNT(DISTINCT like_id) AS likes, COUNT(DISTINCT reply_id) AS replies,
  date_time AS dateTime FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
  LEFT JOIN like ON tweet.tweet_id = like.tweet_id WHERE tweet.user_id = ${userId}
  GROUP BY tweet.tweet_id;`
  const tweets = await db.all(getTweet)
  response.send(tweets)
})

//API 10 post tweet
app.post('/user/tweets/', authenticate, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const createUser = `INSERT INTO tweet(tweet, user_id, date_time) VALUES('${tweet}','${userId}','${dateTime}');`
  await db.run(createUser)
  response.send('Created a Tweet')
})

//API 11 delete tweet
app.delete('/tweets/:tweetId/', authenticate, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const getTweet = `SELECT * FROM tweet WHERE user_id='${userId}' AND tweet_id='${tweetId}';`
  const tweet = await db.get(getTweet)
  console.log(tweet)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deleteTweet = `DELETE FROM tweet WHERE tweet_id='${tweetId}';`
    await db.run(deleteTweet)
    response.sendd('Tweet Removed')
  }
})
module.exports = app
