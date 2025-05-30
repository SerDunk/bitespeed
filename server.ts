import express, { Request, Response } from "express";
import { IdentifyRequest } from "./types";
import db from "./db";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

const app = express();

app.use(express.json());

app.post("/identify", async (req: Request, res: Response): Promise<any> => {
  const { email, phoneNumber }: IdentifyRequest = req.body;

  try {
    // Validation
    if (!email && phoneNumber === undefined) {
      return res.status(400).json({ error: "At least one field required" });
    }

    // Finding existing contacts with mail or phone
    const existingContacts = await db.contact.findMany({
      where: {
        OR: [
          { email: email || undefined },
          { phoneNumber: phoneNumber || undefined },
        ],
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });

    // If no existing contacts
    if (existingContacts.length === 0) {
      const newContact = await db.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: "primary",
        },
      });

      return res.json({
        contact: {
          primaryContactId: newContact.id,
          emails: email ? [email] : [],
          phoneNumbers: phoneNumber ? [phoneNumber.toString()] : [],
          secondaryContactIds: [],
        },
      });
    }

    // Find primary contact (oldest in the group)
    let primaryContact = existingContacts.find(
      (c) => c.linkPrecedence === "primary"
    );

    // If no primary found but has linkedId, find that contact
    if (!primaryContact && existingContacts[0].linkedId) {
      primaryContact =
        (await db.contact.findUnique({
          where: { id: existingContacts[0].linkedId },
        })) ?? undefined;
    }

    // If still no primary, make the oldest one primary
    if (!primaryContact) {
      primaryContact = await db.contact.update({
        where: { id: existingContacts[0].id },
        data: {
          linkPrecedence: "primary",
          linkedId: null,
        },
      });
    }

    // Check if we need to create a new secondary contact
    const exactMatchExists = existingContacts.some(
      (c) => c.email === email && c.phoneNumber === phoneNumber
    );

    if (!exactMatchExists && (email || phoneNumber)) {
      try {
        await db.contact.create({
          data: {
            email,
            phoneNumber,
            linkedId: primaryContact.id,
            linkPrecedence: "secondary",
          },
        });
      } catch (error: unknown) {
        const prismaError = error as PrismaClientKnownRequestError;
        if (prismaError.code === "P2002") {
          // Handle unique constraint violation
          const conflictingContact = await db.contact.findFirst({
            where: {
              OR: [
                { email, phoneNumber: null },
                { email: null, phoneNumber },
                { email, phoneNumber },
              ],
            },
          });

          if (conflictingContact) {
            await db.contact.update({
              where: { id: conflictingContact.id },
              data: {
                linkedId: primaryContact.id,
                linkPrecedence: "secondary",
                // Update null fields if needed
                email: email || conflictingContact.email,
                phoneNumber: phoneNumber || conflictingContact.phoneNumber,
              },
            });
          }
        } else {
          throw error;
        }
      }
    }

    // Check for multiple primary contacts to merge
    const primaryContacts = existingContacts.filter(
      (c) => c.linkPrecedence === "primary"
    );
    if (primaryContacts.length > 1) {
      await db.$transaction([
        // Convert other primaries to secondary
        db.contact.updateMany({
          where: {
            id: {
              in: primaryContacts
                .filter((c) => c.id !== primaryContact!.id)
                .map((c) => c.id),
            },
          },
          data: {
            linkPrecedence: "secondary",
            linkedId: primaryContact.id,
          },
        }),
        // Update their secondaries
        db.contact.updateMany({
          where: {
            linkedId: {
              in: primaryContacts
                .filter((c) => c.id !== primaryContact!.id)
                .map((c) => c.id),
            },
          },
          data: {
            linkedId: primaryContact.id,
          },
        }),
      ]);
    }

    // Get all linked contacts for the response
    const allLinkedContacts = await db.contact.findMany({
      where: {
        OR: [{ id: primaryContact.id }, { linkedId: primaryContact.id }],
        deletedAt: null,
      },
    });

    // Prepare response
    const emails = Array.from(
      new Set(
        allLinkedContacts
          .map((c) => c.email)
          .filter((e): e is string => e !== null)
      )
    );

    const phoneNumbers = Array.from(
      new Set(
        allLinkedContacts
          .map((c) => c.phoneNumber?.toString())
          .filter((p): p is string => p !== undefined)
      )
    );

    const secondaryContactIds = allLinkedContacts
      .filter((c) => c.linkPrecedence === "secondary")
      .map((c) => c.id);

    return res.json({
      contact: {
        primaryContactId: primaryContact.id,
        emails,
        phoneNumbers,
        secondaryContactIds,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server is running");
});
