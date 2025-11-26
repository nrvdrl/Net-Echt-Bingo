import { BingoItem, SubjectContext } from "../types";

const API_KEY = process.env.OPENROUTER_API_KEY || process.env.API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_NAME = "google/gemini-2.0-flash-001"; // Or any other OpenRouter model

/**
 * Helper to call OpenRouter API (OpenAI Compatible)
 */
async function callOpenRouter(messages: any[]) {
  if (!API_KEY) {
    throw new Error("Missing API Key. Please set OPENROUTER_API_KEY.");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "HTTP-Referer": "https://bingo-generator.vercel.app", // Optional: Your site URL
      "X-Title": "Bingo Generator", // Optional: Your site name
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: messages,
      response_format: { type: "json_object" } // Force JSON mode
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("OpenRouter API Error:", err);
    throw new Error(`API call failed: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  
  // Clean markdown code blocks if present (e.g. ```json ... ```)
  const cleanContent = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  return JSON.parse(cleanContent);
}

/**
 * Detects the subject and whether it requires MathJax (LaTeX) rendering.
 */
export const detectSubject = async (
  topic: string,
  imageBase64?: string | null
): Promise<SubjectContext> => {
  
  const messages: any[] = [
    {
      role: "system",
      content: "You are a helpful assistant. Return ONLY valid JSON. Detect the school subject and if math notation (LaTeX) is required."
    }
  ];

  const userContent: any[] = [
    { type: "text", text: `Analyseer de input (tekst: "${topic}") en/of de afbeelding.\n\n1. Bepaal het schoolvak (bijv. Wiskunde, Geschiedenis).\n2. Zet 'isMath' op true ALLEEN als het Wiskunde is (LaTeX nodig).\n\nReturn JSON: { "subject": "Vaknaam", "isMath": boolean }` }
  ];

  if (imageBase64) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: imageBase64 // OpenRouter/OpenAI accepts data URI directly
      }
    });
  }

  messages.push({ role: "user", content: userContent });

  try {
    const result = await callOpenRouter(messages);
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
  
  // 1. Construct System Prompt
  let formatInstruction = "";
  if (context.isMath) {
    formatInstruction = `
      NOTATIE (WISKUNDE):
      - Gebruik LaTeX code voor symbolen in zowel 'problem' als 'answer'.
      - GEEN dollartekens ($).
      - Gebruik \\times voor keer, \\frac{a}{b} voor breuken.
    `;
  } else {
    formatInstruction = `
      NOTATIE (TEKST):
      - Gebruik GEEN LaTeX. Gewone tekst.
      - 'problem': De vraag/omschrijving die de leraar voorleest.
      - 'answer': Het KORTE antwoord (1-4 woorden).
    `;
  }

  const systemMessage = `
    Je bent een docent voor het vak ${context.subject}.
    Genereer output voor een Bingo spel.
    ${formatInstruction}
    Variatie: Zorg voor minimaal 13 unieke antwoorden.
    
    IMPORTANT: Return a JSON Object with a property "items" containing an array of objects.
    Example: { "items": [{ "problem": "...", "answer": "..." }] }
  `;

  // 2. Construct User Prompt
  let userPromptText = "";
  if (imageBase64 && mode === 'exact') {
    userPromptText = `Maak een lijst van PRECIES ${count} items. EXTRACTIE: Neem inhoud EXACT over uit de afbeelding. Vul aan indien te weinig.`;
  } else if (imageBase64 && mode === 'similar') {
    userPromptText = `Genereer ${count} NIEUWE unieke items die qua stijl en niveau lijken op de afbeelding.`;
  } else {
    userPromptText = `Onderwerp: "${topicInput}". Genereer precies ${count} unieke items (vraag + antwoord).`;
  }

  const userContent: any[] = [{ type: "text", text: userPromptText }];
  
  if (imageBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: imageBase64 }
    });
  }

  const messages = [
    { role: "system", content: systemMessage },
    { role: "user", content: userContent }
  ];

  try {
    const rawData = await callOpenRouter(messages);
    
    // Handle wrapped object { items: [...] } or direct array (fallback)
    const itemsArray = Array.isArray(rawData) ? rawData : (rawData.items || []);

    return itemsArray.map((item: any, index: number) => ({
      id: `item-${index}`,
      problem: item.problem || "Fout",
      answer: item.answer || "Fout",
    }));

  } catch (error) {
    console.error("Error generating bingo items:", error);
    throw new Error("Kon geen items genereren. Probeer het opnieuw.");
  }
};