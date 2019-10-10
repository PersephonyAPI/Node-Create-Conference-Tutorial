require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const persephonySDK = require('@persephony/sdk')

const app = express()
app.use(bodyParser.json())
// Where your app is hosted ex. www.myapp.com
const host = process.env.HOST
const port = process.env.PORT || 3000
// your Persephony API key (available in the Dashboard) - be sure to set up environment variables to store these values
const accountId = process.env.ACCOUNT_ID
const authToken = process.env.AUTH_TOKEN
const persephony = persephonySDK(accountId, authToken)

function ConferenceRoom() {
  // stores conferenceId associated with this room
  this.conferenceId = null

  // true if the CreateConference command was sent but the actionUrl has not yet been called, else false
  this.isConferencePending = false

  // Set to true after the conference status is first set to EMPTY, meaning that the next EMPTY status received indicates that all participants have left the conference and so the conference can terminate
  this.canConferenceTerminate = false
}

const conferenceRoomsCodes = ['1', '2', '3']
const conferenceRooms = new Map()

for (let code in conferenceRoomsCodes) {
  conferenceRooms.set(code, new ConferenceRoom())
}

app.post('/incomingCall', (req, res) => {
  // Create PerCL say command
  const greeting = persephony.percl.say('Hello. Welcome to the conferences tutorial, please enter your access code.')
  // Create PerCL for getDigits command
  const options = {
    maxDigits: 1,
    minDigits: 1,
    flushBuffer: true
  }
  const getDigits = persephony.percl.getDigits(`${host}/gotDigits`, options)
  // Build and respond with Percl command
  const percl = persephony.percl.build(greeting, getDigits)
  res.status(200).json(percl)
})

app.post('/gotDigits', (req, res) => {
  const getDigitsResponse = req.body
  const digits = getDigitsResponse.digits
  const callId = getDigitsResponse.callId

  const room = conferenceRooms.get(digits)
  if (room === undefined) {
    // Handle case where no room with the given code exists
  }
  // if participants can't be added yet (actionUrl callback has not been called) notify caller and hang up
  if (room.isConferencePending) {
    const say = persephony.percl.say('We are sorry, you cannot be added to the conference at this time. Please try again later.')
    const percl = persephony.percl.build(say)
    res.status(200).json(percl)
  } else {
    const say = persephony.percl.say('You will be added to the conference momentarily.')
    const makeOrAddToConfScript = makeOrAddToConference(room, digits, callId)
    const percl = persephony.percl.build(say, makeOrAddToConfScript)
    res.status(200).json(percl)
  }
})

function makeOrAddToConference(room, roomCode, callId) {
  if (room.conferenceId == null) {
    // If a conference has not been created for this room yet, return a CreateConference PerCL command
    room.isConferencePending = true
    room.canConferenceTerminate = false
    options = {
      statusCallbackUrl: `${host}/conferenceStatus/${roomCode}`
    }
    // Create CreateConference PerCL command
    return persephony.percl.createConference(`${host}/conferenceCreated/${roomCode}`, options)
  } else {
    // If a conference has been created and the actionUrl callback has been called, return a AddToConference PerCL command
    return persephony.percl.addToConference(room.conferenceId, callId)
  }
}

app.post('/conferenceCreated/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode
  const conferenceCreatedResponse = req.body
  const conferenceId = conferenceCreatedResponse.conferenceId
  const callId = conferenceCreatedResponse.callId
  // find which conference room the newly created conference belongs to
  const room = conferenceRooms.get(roomCode)

  if (room === undefined) {
    // Handle case where callback is called for a room that does not exist
  }

  room.conferenceId = conferenceId
  room.isConferencePending = false
  // Create AddToConference PerCL command
  const addToConference = persephony.percl.addToConference(conferenceId, callId)
  const percl = persephony.percl.build(addToConference)
  res.status(200).json(percl)
})

app.post('/conferenceStatus/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode
  const conferenceStatusResponse = req.body
  const status = conferenceStatusResponse.status
  const conferenceId = conferenceStatusResponse.conferenceId

  // find which conference room the conference belongs to
  const room = conferenceRooms.get(roomCode)

  if (room === undefined) {
    // Handle case where callback is called for a room that does not exist
  }

  if (status === persephony.enums.conferenceStatus.EMPTY && room.canConferenceTerminate) {
    terminateConference(conferenceId)
  }
  // after first EMPTY status update conference can be terminated
  room.canConferenceTerminate = true
  res.status(200)
})

// Specify this route with 'Status Callback URL' in App Config
app.post('/status', (req, res) => {
  // handle status changes
  res.status(200)
})

function terminateConference(conferenceId) {
  // Create the ConferenceUpdateOptions and set the status to terminated
  const options = {
    status: persephony.enums.conferenceStatus.TERMINATED
  }
  persephony.api.conferences.update(conferenceId, options)
}

app.listen(port, () => {
  console.log(`Starting server on port ${port}`)
})