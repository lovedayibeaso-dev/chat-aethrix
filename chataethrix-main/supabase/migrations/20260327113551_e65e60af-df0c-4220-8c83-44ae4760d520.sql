
ALTER TABLE public.profiles
ADD COLUMN daily_message_count integer NOT NULL DEFAULT 0,
ADD COLUMN last_message_date date NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN subscription_tier text NOT NULL DEFAULT 'free';
