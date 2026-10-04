export interface CommunityRouteState {
  statusTitle: string
  statusDescription: string
}

const homeRoute: CommunityRouteState = {
  statusTitle: '커뮤니티를 준비하고 있습니다',
  statusDescription:
    '좋은 질문과 경험이 오래 읽히는 공간을 만들고 있습니다. 첫 글이 도착할 때까지 잠시만 기다려 주세요.',
}

const notFoundRoute: CommunityRouteState = {
  statusTitle: '페이지를 찾을 수 없습니다',
  statusDescription: '요청하신 커뮤니티 페이지가 없거나 주소가 변경되었습니다.',
}

const communityRoutes: Record<string, CommunityRouteState> = {
  '/community': homeRoute,
  '/community/write': {
    statusTitle: '글쓰기 화면을 준비하고 있습니다',
    statusDescription: '개발 경험을 편안하게 기록할 수 있는 글쓰기 도구를 만들고 있습니다.',
  },
  '/community/post': {
    statusTitle: '게시글 화면을 준비하고 있습니다',
    statusDescription: '글과 답변을 읽기 좋은 형태로 보여 드릴 준비를 하고 있습니다.',
  },
  '/community/edit': {
    statusTitle: '글 수정 화면을 준비하고 있습니다',
    statusDescription: '작성한 글을 안전하게 다듬을 수 있는 화면을 만들고 있습니다.',
  },
  '/community/admin/reports': {
    statusTitle: '신고 관리 화면을 준비하고 있습니다',
    statusDescription: '커뮤니티 운영자가 신고를 공정하게 검토할 수 있는 화면을 만들고 있습니다.',
  },
  '/community/auth/callback': {
    statusTitle: '로그인 확인 화면을 준비하고 있습니다',
    statusDescription: '로그인 결과를 안전하게 확인하는 화면을 만들고 있습니다.',
  },
}

export function resolveCommunityRoute(pathname: string): CommunityRouteState {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  return communityRoutes[normalizedPathname] ?? notFoundRoute
}
