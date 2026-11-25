import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';

const SEX = ['male', 'female'];
const ACTIVITY = ['sedentary', 'light', 'moderate', 'high', 'very_high'];
const GOAL = ['lose', 'maintain', 'gain'];

function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return null;
  return v;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const supabase = db();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (data) return res.status(200).json({ profile: data });

      const { data: created, error: insertError } = await supabase
        .from('profiles')
        .insert({
          telegram_id: user.id,
          first_name: user.first_name ?? null,
          username: user.username ?? null,
          language: 'uk',
        })
        .select('*')
        .single();
      if (insertError) throw insertError;
      return res.status(200).json({ profile: created });
    }

    if (req.method === 'PUT') {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const age = num(b.age, 10, 100);
      const height = num(b.height_cm, 100, 250);
      const weight = num(b.weight_kg, 30, 300);
      const target = num(b.target_weight_kg, 30, 300);
      const kcal = num(b.kcal_goal, 800, 6000);
      const protein = num(b.protein_goal_g, 0, 500);
      const fat = num(b.fat_goal_g, 0, 400);
      const carbs = num(b.carbs_goal_g, 0, 1000);
      const water = num(b.water_goal_ml, 500, 6000);
      const sex = typeof b.sex === 'string' && SEX.includes(b.sex) ? b.sex : null;
      const activity =
        typeof b.activity_level === 'string' && ACTIVITY.includes(b.activity_level)
          ? b.activity_level
          : null;
      const goal = typeof b.goal === 'string' && GOAL.includes(b.goal) ? b.goal : null;
      const today =
        typeof b.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : null;

      if (
        age === null || height === null || weight === null || target === null ||
        kcal === null || protein === null || fat === null || carbs === null ||
        water === null || !sex || !activity || !goal || !today
      ) {
        return res.status(400).json({ error: 'invalid_data' });
      }

      const birthYear = Number(today.slice(0, 4)) - Math.round(age);

      const { data, error } = await supabase
        .from('profiles')
        .upsert(
          {
            telegram_id: user.id,
            first_name: user.first_name ?? null,
            username: user.username ?? null,
            sex,
            birth_year: birthYear,
            height_cm: height,
            weight_kg: weight,
            target_weight_kg: target,
            activity_level: activity,
            goal,
            kcal_goal: Math.round(kcal),
            protein_goal_g: Math.round(protein),
            fat_goal_g: Math.round(fat),
            carbs_goal_g: Math.round(carbs),
            water_goal_ml: Math.round(water),
            onboarded: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'telegram_id' },
        )
        .select('*')
        .single();
      if (error) throw error;

      // Перший запис в історії ваги
      const { error: weightError } = await supabase
        .from('weight_logs')
        .upsert(
          { owner_id: user.id, log_date: today, weight_kg: weight },
          { onConflict: 'owner_id,log_date' },
        );
      if (weightError) throw weightError;

      // Історія цілей: з сьогоднішнього дня діє ця норма, а минулі дні лишаються з попередньою
      const { error: goalError } = await supabase.from('goal_history').upsert(
        {
          owner_id: user.id,
          effective_from: today,
          kcal_goal: Math.round(kcal),
          protein_goal_g: Math.round(protein),
          fat_goal_g: Math.round(fat),
          carbs_goal_g: Math.round(carbs),
        },
        { onConflict: 'owner_id,effective_from' },
      );
      if (goalError) console.error('goal_history error', goalError);

      return res.status(200).json({ profile: data });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('profile api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
