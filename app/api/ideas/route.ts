import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const ideas = await prisma.idea.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(ideas);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, description } = body;

    if (!email || !description) {
      return NextResponse.json({ error: "邮箱和需求描述不能为空" }, { status: 400 });
    }

    if (description.length > 200) {
      return NextResponse.json({ error: "需求描述不能超过200字" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 });
    }

    const newIdea = await prisma.idea.create({
      data: {
        email,
        description: description.trim(),
      },
    });

    return NextResponse.json(newIdea, { status: 201 });
  } catch {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
