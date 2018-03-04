import {Router} from "express";
import bot from "../services/facebook/messengerbot";
import cron from "./cron";
import "./bothooks";

const router = new Router();

// Webhook for facebook
router.get('/*', (req, res) => {
  return bot._verify(req, res)
})

// For when we set up a timed API call
router.post('/periodic-update', (req, res) => {
  cron.periodicUpdate(req, res);
});

// Let the bot handle every message
router.post('/*', (req, res) => {
  bot._handleMessage(req.body)
  res.end(JSON.stringify({status: 'ok'}))
});

export default router;
