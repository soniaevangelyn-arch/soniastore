-- 1. Create table products
DROP TABLE IF EXISTS public.products;
CREATE TABLE public.products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT,
    price INTEGER NOT NULL,
    discount_price INTEGER,
    sales INTEGER NOT NULL DEFAULT 0,
    affiliate_link TEXT NOT NULL,
    image_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Setup RLS for products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access" ON public.products FOR SELECT USING (true);
CREATE POLICY "Allow authenticated full access" ON public.products FOR ALL USING (auth.role() = 'authenticated');

-- 3. Insert Dummy Data
INSERT INTO public.products (title, category, subcategory, price, discount_price, sales, affiliate_link, image_url)
VALUES 
('Skintific 5X Ceramide Barrier Moisture Gel 30g', 'Perawatan & Kecantikan', 'Skincare', 169000, 135000, 15000, 'https://shope.ee/dummy_link_1', 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'),
('Corkcicle Canteen Tumbler Blue Quartz 16oz', 'Tumbler', null, 799000, null, 1500, 'https://shope.ee/dummy_link_2', 'https://images.unsplash.com/photo-1544414603-9bd4baf48a9f?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'),
('Casing HP Aesthetic Coquette Ribbon iPhone 14', 'Aksesoris Handphone', null, 55000, 35000, 500, 'https://shope.ee/dummy_link_3', 'https://images.unsplash.com/photo-1601593346740-925612772716?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80');

-- 4. Create Storage Bucket (if not exists)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Create table feedbacks
DROP TABLE IF EXISTS public.feedbacks;
CREATE TABLE public.feedbacks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Setup RLS for feedbacks
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public inserts" ON public.feedbacks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow authenticated read" ON public.feedbacks FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated delete" ON public.feedbacks FOR DELETE USING (auth.role() = 'authenticated');
