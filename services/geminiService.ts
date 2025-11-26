import { GoogleGenAI, Type } from "@google/genai";
import { BingoItem, SubjectContext } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_NAME = "gemini-2.5-flash";

/**
 * Detects the subject and whether it requires MathJax (LaTeX) rendering.
 */
export const detectSubject = async (
  topic: string,
  imageBase64?: string | null
): Promise<SubjectContext> => {
  const parts: any[] = [];

  if (imageBase64) {
    const [header, base64Data] = imageBase64.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    parts.push({
      inlineData: { mimeType, data: base64Data }
    });
  }

  const prompt = `
    Analyseer de input (tekst: "${topic}") en/of de afbeelding.
    
    1. Bepaal het schoolvak of onderwerp (bijv. Wiskunde, Geschiedenis, Frans, Aardrijkskunde, Biologie, Algemene Kennis).
    2. Bepaal of het onderwerp complexe wiskundige notatie (LaTeX) vereist. 
       - Zet 'isMath' op true ALLEEN als het vak Wiskunde is.
       - Zet 'isMath' op false voor ALLE andere vakken (dus ook voor Natuurkunde, Scheikunde, etc.).

    Return JSON.
  `;

  parts.push({ text: prompt });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING, description: "De naam van het vak in het Nederlands" },
            isMath: { type: Type.BOOLEAN, description: "True als LaTeX nodig is, anders False" }
          },
          required: ["subject", "isMath"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return {
      subject: result.subject || "Algemeen",
      isMath: !!result.isMath
    };
  } catch (error) {
    console.error("Error detecting subject:", error);
    return { subject: "Algemeen", isMath: false };
  }
};

/**
 * Generates the pool of bingo items based on subject and mode.
 */
export const generateBingoItems = async (
  context: SubjectContext,
  topicInput: string,
  count: number,
  imageBase64?: string | null,
  mode: 'similar' | 'exact' = 'similar'
): Promise<BingoItem[]> => {
  
  let userPrompt = "";
  const parts: any[] = [];

  // Add Image if present
  if (imageBase64) {
    const [header, base64Data] = imageBase64.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    parts.push({
      inlineData: { mimeType, data: base64Data }
    });
  }

  // Construct Prompt based on Mode and Image presence
  if (imageBase64 && mode === 'exact') {
    userPrompt = `
      Je bent een assistent voor het vak ${context.subject}.
      DOEL: Maak een lijst van PRECIES ${count} vragen/antwoorden gebaseerd op de afbeelding.

      STAP 1: EXTRACTIE
      Neem de inhoud EXACT over uit de afbeelding.
      
      STAP 2: AANVULLEN
      Als er minder dan ${count} items zijn, verzin er dan bijpassende items bij.
    `;
  } else if (imageBase64 && mode === 'similar') {
    userPrompt = `
      Je bent een docent voor het vak ${context.subject}.
      Genereer ${count} NIEUWE unieke items die qua stijl en niveau lijken op de afbeelding.
    `;
  } else {
    userPrompt = `
      Je bent een docent voor het vak ${context.subject}.
      Onderwerp: "${topicInput}".
      Genereer precies ${count} unieke items (vraag + antwoord) voor een Bingo spel.
    `;
  }

  // Formatting instructions based on Subject Type
  let formatInstruction = "";
  if (context.isMath) {
    formatInstruction = `
      NOTATIE (WISKUNDE):
      - Gebruik LaTeX code voor symbolen in zowel 'problem' als 'answer'.
      - GEEN dollartekens.
      - Gebruik \\times voor keer, \\frac{a}{b} voor breuken.
      - Houd de 'answer' kort en bondig.
    `;
  } else {
    formatInstruction = `
      NOTATIE (TEKST):
      - Gebruik GEEN LaTeX. Gewone tekst.
      - 'problem': De vraag of omschrijving die de leraar voorleest.
      - 'answer': Het KORTE antwoord (max 1-4 woorden) dat in een klein bingo-vakje past.
      - Voorbeeld Geschiedenis: problem="In welk jaar begon WO2?", answer="1939".
      - Voorbeeld Frans: problem="Vertaal 'hond'", answer="Le chien".
    `;
  }

  const systemInstruction = `
    Genereer output voor een Bingo spel.
    
    ${formatInstruction}

    Variatie: Zorg voor minimaal 13 unieke antwoorden.
    Output alleen JSON array.
  `;

  parts.push({ text: userPrompt + systemInstruction });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              problem: { type: Type.STRING, description: "De vraag/omschrijving voor de lijst." },
              answer: { type: Type.STRING, description: "Het antwoord voor op de kaart." },
            },
            required: ["problem", "answer"],
          },
        },
      },
    });

    const rawData = JSON.parse(response.text || "[]");
    
    return rawData.map((item: any, index: number) => ({
      id: `item-${index}`,
      problem: item.problem,
      answer: item.answer,
    }));

  } catch (error) {
    console.error("Error generating bingo items:", error);
    throw new Error("Kon geen items genereren. Probeer het opnieuw.");
  }
};