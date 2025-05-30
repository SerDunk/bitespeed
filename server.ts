import express, { Request, Response } from "express";
import { IdentifyRequest, IdentifyResponse } from "./types";
import db from "./db";

const app = express();

app.use(express.json());

app.post("/identify", async (req: Request, res: Response) => {
  const { email, phoneNumber }: IdentifyRequest = req.body;

  try {
    const contact = await db.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: "primary",
      },
    });

    const response = await db.contact.findUnique({
      where: {
        phoneNumber: phoneNumber,
      },
    });

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed" });
  }
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log("Server is running");
});
